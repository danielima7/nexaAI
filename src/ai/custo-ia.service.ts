import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/** Preco de um modelo, em dolares por 1 milhao de tokens. */
interface Preco {
  entrada: number;
  saida: number;
}

/** Consumo e custo de um recorte (por modelo, por organizacao ou total). */
export interface Custo {
  usd: number;
  brl: number;
  interacoes: number;
}

export interface RelatorioCusto extends Custo {
  porModelo: { modelo: string; usd: number; brl: number; interacoes: number }[];
  porOrganizacao: {
    organizationId: string | null;
    usd: number;
    brl: number;
    interacoes: number;
  }[];
}

/**
 * Calcula quanto a IA custou, a partir do que o AiUsage ja registra.
 *
 * Existe porque a unica forma de descobrir gasto excessivo hoje seria a fatura
 * da Anthropic — que chega depois. Com a rota publica de cadastro no ar, o
 * intervalo entre "alguem comecou a abusar" e "eu descobri" precisa ser de
 * minutos, nao de trinta dias.
 */
@Injectable()
export class CustoIaService {
  private readonly logger = new Logger(CustoIaService.name);

  /**
   * Precos oficiais (USD por 1M tokens), conferidos em 2026-08.
   *
   * Deliberadamente com o preco CHEIO do Sonnet 5 ($3/$15), e nao o
   * promocional de lancamento: subestimar custo derrota o proposito de um
   * alerta de custo. Quando a promocao acabar, a conta ja estara certa.
   */
  private static readonly PRECOS: Record<string, Preco> = {
    'claude-opus-5': { entrada: 5, saida: 25 },
    'claude-opus-4-8': { entrada: 5, saida: 25 },
    'claude-opus-4-7': { entrada: 5, saida: 25 },
    'claude-opus-4-6': { entrada: 5, saida: 25 },
    'claude-sonnet-5': { entrada: 3, saida: 15 },
    'claude-sonnet-4-6': { entrada: 3, saida: 15 },
    'claude-haiku-4-5': { entrada: 1, saida: 5 },
  };

  /**
   * Preco assumido para modelo desconhecido: o mais caro da tabela.
   *
   * Fail-safe na direcao certa — se alguem apontar o .env para um modelo novo
   * e caro, o alerta dispara cedo demais em vez de tarde demais.
   */
  private static readonly PRECO_DESCONHECIDO: Preco = { entrada: 5, saida: 25 };

  /** Cache lido custa ~10% da entrada; cache escrito, ~125%. */
  private static readonly FATOR_CACHE_LEITURA = 0.1;
  private static readonly FATOR_CACHE_ESCRITA = 1.25;

  private static readonly COTACAO_PADRAO = 5.4;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Cotacao do dolar usada para exibir valores em real. */
  get cotacao(): number {
    const bruto = Number(this.config.get<string>('KATALLI_COTACAO_USD'));
    return Number.isFinite(bruto) && bruto > 0
      ? bruto
      : CustoIaService.COTACAO_PADRAO;
  }

  private precoDe(modelo: string): Preco {
    const preco = CustoIaService.PRECOS[modelo];
    if (preco) return preco;

    this.logger.warn(
      `Modelo sem preco na tabela: "${modelo}". Assumindo o mais caro para nao subestimar o custo.`,
    );
    return CustoIaService.PRECO_DESCONHECIDO;
  }

  /** Custo em dolares de um conjunto de contadores de token. */
  private calcular(
    modelo: string,
    t: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    },
  ): number {
    const p = this.precoDe(modelo);
    const entrada =
      t.inputTokens +
      t.cacheReadTokens * CustoIaService.FATOR_CACHE_LEITURA +
      t.cacheWriteTokens * CustoIaService.FATOR_CACHE_ESCRITA;

    return (entrada * p.entrada + t.outputTokens * p.saida) / 1_000_000;
  }

  /** Meia-noite de hoje no fuso do servidor. */
  static inicioDoDia(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Relatorio de custo desde uma data.
   *
   * A quebra por organizacao e o que transforma o alerta em acao: saber que
   * gastou R$ 80 nao diz o que fazer; saber que R$ 74 vieram de uma conta de
   * autocadastro criada hoje, sim.
   */
  async relatorio(desde: Date): Promise<RelatorioCusto> {
    const registros = await this.prisma.aiUsage.findMany({
      where: { createdAt: { gte: desde } },
      select: {
        modelo: true,
        organizationId: true,
        rodada: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
    });

    const porModelo = new Map<string, { usd: number; interacoes: number }>();
    const porOrg = new Map<
      string | null,
      { usd: number; interacoes: number }
    >();
    let usd = 0;
    let interacoes = 0;

    for (const r of registros) {
      const custo = this.calcular(r.modelo, r);
      usd += custo;
      // Interacao = turno do usuario. As rodadas seguintes do loop de tool use
      // custam, mas nao sao pedidos novos — contar todas inflaria o numero.
      const conta = r.rodada === 0 ? 1 : 0;
      interacoes += conta;

      const m = porModelo.get(r.modelo) ?? { usd: 0, interacoes: 0 };
      m.usd += custo;
      m.interacoes += conta;
      porModelo.set(r.modelo, m);

      const o = porOrg.get(r.organizationId) ?? { usd: 0, interacoes: 0 };
      o.usd += custo;
      o.interacoes += conta;
      porOrg.set(r.organizationId, o);
    }

    const cotacao = this.cotacao;
    const emReal = (v: number) => Math.round(v * cotacao * 100) / 100;

    return {
      usd: Math.round(usd * 10000) / 10000,
      brl: emReal(usd),
      interacoes,
      porModelo: [...porModelo.entries()]
        .map(([modelo, v]) => ({
          modelo,
          usd: Math.round(v.usd * 10000) / 10000,
          brl: emReal(v.usd),
          interacoes: v.interacoes,
        }))
        .sort((a, b) => b.usd - a.usd),
      porOrganizacao: [...porOrg.entries()]
        .map(([organizationId, v]) => ({
          organizationId,
          usd: Math.round(v.usd * 10000) / 10000,
          brl: emReal(v.usd),
          interacoes: v.interacoes,
        }))
        .sort((a, b) => b.usd - a.usd),
    };
  }

  /** Atalho para o dia corrente. */
  relatorioDeHoje(): Promise<RelatorioCusto> {
    return this.relatorio(CustoIaService.inicioDoDia());
  }
}
