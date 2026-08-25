import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { GoogleService } from '../integrations/google/google.service';
import { MetricaService } from '../metricas/metrica.service';

/** Resultado de uma tentativa de envio. */
export interface ResultadoEnvio {
  enviado: boolean;
  /** Frase pronta para a IA repetir ao usuario. */
  motivo: string;
}

/**
 * Prospeccao por e-mail, com as travas que impedem o tiro no proprio pe.
 *
 * O envio em si ja existia (GoogleService.sendEmail). O que este service
 * acrescenta e MEMORIA, e e ela que separa prospeccao de dano:
 *
 *  - quem ja foi contatado nao recebe de novo;
 *  - quem pediu para sair nunca mais recebe;
 *  - existe um teto diario, porque reputacao de dominio se perde de uma vez e
 *    se recupera devagar.
 *
 * NAO existe envio em massa aqui de proposito. Cada mensagem sai com uma
 * confirmacao, uma de cada vez. Disparo automatico para lista comprada e
 * exatamente o padrao que fez a Meta banir os dois numeros de WhatsApp deste
 * projeto; repetir isso no e-mail queimaria o dominio do mesmo jeito, e ai a
 * perda inclui o resumo diario e os alertas que saem pelo mesmo endereco.
 */
@Injectable()
export class ProspeccaoService {
  private readonly logger = new Logger(ProspeccaoService.name);

  /**
   * Teto diario padrao, deliberadamente baixo.
   *
   * Dominio novo nao tem reputacao: provedores medem volume, taxa de recusa e
   * denuncia nos primeiros envios e decidem ali se voce e remetente legitimo.
   * Comecar com dezenas por dia e subir devagar e o que constroi reputacao;
   * mandar centenas na primeira semana e o que a destroi de forma dificil de
   * reverter.
   */
  private static readonly TETO_DIARIO_PADRAO = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connections: ConnectionsService,
    private readonly google: GoogleService,
  ) {}

  private get tetoDiario(): number {
    const bruto = Number(this.config.get<string>('KATALLI_PROSPECCAO_LIMITE_DIA'));
    return Number.isFinite(bruto) && bruto > 0
      ? bruto
      : ProspeccaoService.TETO_DIARIO_PADRAO;
  }

  /** Normaliza o e-mail: caixa e espaco nao podem criar contato duplicado. */
  static normalizar(email: string): string {
    return String(email ?? '').trim().toLowerCase();
  }

  /** Quantos envios ja sairam hoje (fuso de Sao Paulo). */
  async enviadosHoje(organizationId: string): Promise<number> {
    return this.prisma.prospecto.count({
      where: {
        organizationId,
        status: { not: 'descadastrado' },
        contatadoEm: { gte: MetricaService.diaDeHoje() },
      },
    });
  }

  /** Situacao da prospeccao — para a IA responder sem tentar enviar. */
  async situacao(organizationId: string) {
    const [hoje, total, descadastrados] = await Promise.all([
      this.enviadosHoje(organizationId),
      this.prisma.prospecto.count({ where: { organizationId } }),
      this.prisma.prospecto.count({
        where: { organizationId, status: 'descadastrado' },
      }),
    ]);

    return {
      enviadosHoje: hoje,
      restanteHoje: Math.max(0, this.tetoDiario - hoje),
      tetoDiario: this.tetoDiario,
      totalContatados: total,
      descadastrados,
    };
  }

  /** Marca um contato como "nunca mais". Definitivo. */
  async descadastrar(
    organizationId: string,
    email: string,
    motivo?: string,
  ): Promise<void> {
    const alvo = ProspeccaoService.normalizar(email);

    await this.prisma.prospecto.upsert({
      where: { organizationId_email: { organizationId, email: alvo } },
      create: {
        organizationId,
        email: alvo,
        status: 'descadastrado',
        observacao: motivo,
      },
      update: { status: 'descadastrado', observacao: motivo },
    });

    this.logger.log(`Contato ${alvo} descadastrado na organizacao ${organizationId}.`);
  }

  /**
   * Envia UM e-mail de prospeccao, com todas as travas conferidas antes.
   *
   * A ordem das conferencias importa: descadastro primeiro, porque e o unico
   * que representa um pedido explicito de alguem. Depois duplicata, depois
   * teto. Assim a mensagem devolvida diz a razao mais relevante.
   */
  async enviar(
    organizationId: string,
    dados: {
      email: string;
      assunto: string;
      corpo: string;
      nome?: string;
      empresa?: string;
      origem?: string;
    },
  ): Promise<ResultadoEnvio> {
    const email = ProspeccaoService.normalizar(dados.email);

    if (!email.includes('@')) {
      return { enviado: false, motivo: `"${dados.email}" nao parece um e-mail valido.` };
    }

    const existente = await this.prisma.prospecto.findUnique({
      where: { organizationId_email: { organizationId, email } },
    });

    if (existente?.status === 'descadastrado') {
      return {
        enviado: false,
        motivo: `${email} pediu para nao receber mais contato. Nao envie para este endereco.`,
      };
    }

    if (existente) {
      const quando = existente.contatadoEm.toLocaleDateString('pt-BR');
      return {
        enviado: false,
        motivo: `${email} ja foi contatado em ${quando}. Nao envie de novo sem o usuario pedir explicitamente.`,
      };
    }

    const enviadosHoje = await this.enviadosHoje(organizationId);
    if (enviadosHoje >= this.tetoDiario) {
      return {
        enviado: false,
        motivo:
          `O limite de ${this.tetoDiario} envios por dia foi atingido (${enviadosHoje} hoje). ` +
          'O teto protege a reputacao do dominio: volume alto de dominio novo faz os proximos e-mails cairem em spam. Continue amanha.',
      };
    }

    const token = await this.connections.resolveToken(
      { organizationId },
      'google',
      'GOOGLE_REFRESH_TOKEN',
    );
    if (!token) {
      return {
        enviado: false,
        motivo: 'O Google nao esta conectado. Conecte em Integracoes para poder enviar.',
      };
    }

    try {
      await this.google.sendEmail(
        token,
        email,
        dados.assunto,
        ProspeccaoService.comSaidaFacil(dados.corpo),
      );
    } catch (erro: unknown) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao enviar prospeccao para ${email}: ${detalhe}`);

      if (detalhe.includes('invalid_grant')) {
        return {
          enviado: false,
          motivo: 'A autorizacao do Google expirou. Reconecte em Integracoes.',
        };
      }
      return { enviado: false, motivo: 'Nao consegui enviar agora. Tente em instantes.' };
    }

    // Registrado DEPOIS do envio: gravar antes marcaria como contatado alguem
    // que nao recebeu nada, e essa pessoa nunca mais seria abordada.
    await this.prisma.prospecto.create({
      data: {
        organizationId,
        email,
        nome: dados.nome,
        empresa: dados.empresa,
        origem: dados.origem,
      },
    });

    const restante = this.tetoDiario - enviadosHoje - 1;
    return {
      enviado: true,
      motivo: `E-mail enviado para ${email}. Restam ${restante} envios hoje.`,
    };
  }

  /**
   * Garante uma forma de sair, no fim do corpo.
   *
   * Vai no service e nao no prompt de proposito: e obrigacao de quem manda
   * mensagem comercial nao solicitada, e a LGPD trata o pedido de oposicao
   * como direito do titular. Deixar isso a cargo da IA lembrar em cada envio e
   * garantir que um dia ela esqueca — e o e-mail sem saida e o que gera
   * denuncia de spam, que e o que de fato mata o dominio.
   */
  static comSaidaFacil(corpo: string): string {
    const marca = 'responda com "sair"';
    if (corpo.toLowerCase().includes(marca)) return corpo;

    return (
      corpo.trimEnd() +
      '\n\n---\n' +
      'Se preferir não receber mais contatos, responda com "sair" e eu removo seu endereço.'
    );
  }
}
