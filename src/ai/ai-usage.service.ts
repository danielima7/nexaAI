import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { RotaIa } from './model-router.service';

/** Identificacao da chamada, para atribuir o consumo a quem o gerou. */
export interface EscopoUso {
  rota: RotaIa;
  modelo: string;
  rodada: number;
  organizationId?: string;
  userId?: string;
}

/**
 * Registra o consumo de tokens de cada chamada a API.
 *
 * Gravacao best-effort, no mesmo espirito do OperationLog: telemetria nunca
 * pode derrubar a resposta ao cliente. Se o banco estiver fora, perdemos a
 * linha de custo — nao a conversa.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quantas mensagens a organizacao ja enviou no chat.
   *
   * Conta apenas `rodada: 0` — a primeira chamada de cada turno. Um turno
   * pode gerar varias chamadas a API (o loop de tool use), e cobrar do
   * cliente por rodadas internas seria puni-lo por a pergunta dele ter
   * exigido tres ferramentas em vez de uma.
   *
   * Restrito a rota `chat` de proposito: resumo diario e alertas sao
   * disparados por nos, nao por ele, e nao devem consumir a cota dele.
   */
  async contarInteracoes(organizationId: string): Promise<number> {
    return this.prisma.aiUsage.count({
      where: { organizationId, rota: 'chat', rodada: 0 },
    });
  }

  /**
   * Instante da meia-noite de hoje no fuso de Sao Paulo.
   *
   * O fuso e explicito porque o servidor de producao roda em UTC: usar a
   * meia-noite local do processo faria a cota do cliente virar as 21h — ele
   * perderia tres horas de uso todo dia, sem entender por que.
   */
  static inicioDoDiaBrasil(): Date {
    const agora = new Date();
    // Formata a data no fuso alvo e reconstroi o instante correspondente.
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(agora);

    const p = (t: string) => Number(partes.find((x) => x.type === t)?.value);
    // Quanto ja se passou do dia em Sao Paulo, subtraido do instante atual.
    const decorridoMs =
      (p('hour') * 3600 + p('minute') * 60 + p('second')) * 1000;
    return new Date(agora.getTime() - decorridoMs);
  }

  /**
   * Tokens que a organizacao consumiu hoje, somando entrada, saida e cache.
   *
   * Soma TUDO de proposito: e o volume que a Anthropic mede e o unico numero
   * explicavel ao cliente sem entrar em precificacao de cache. Para custo
   * real, com os pesos de cada tipo, use o CustoIaService.
   *
   * Conta todas as rodadas, nao so a primeira: o loop de tool use consome de
   * verdade, e uma pergunta que aciona cinco ferramentas gasta mesmo mais cota
   * do que uma que nao aciona nenhuma.
   */
  async tokensDoDia(organizationId: string): Promise<number> {
    const soma = await this.prisma.aiUsage.aggregate({
      where: {
        organizationId,
        createdAt: { gte: AiUsageService.inicioDoDiaBrasil() },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
    });

    return (
      (soma._sum.inputTokens ?? 0) +
      (soma._sum.outputTokens ?? 0) +
      (soma._sum.cacheReadTokens ?? 0) +
      (soma._sum.cacheWriteTokens ?? 0)
    );
  }

  async registrar(escopo: EscopoUso, usage: Anthropic.Usage): Promise<void> {
    try {
      await this.prisma.aiUsage.create({
        data: {
          rota: escopo.rota,
          modelo: escopo.modelo,
          rodada: escopo.rodada,
          organizationId: escopo.organizationId ?? null,
          userId: escopo.userId ?? null,
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      });
    } catch (error: unknown) {
      const detalhe = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Falha ao registrar consumo de tokens: ${detalhe}`);
    }
  }
}
