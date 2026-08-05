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
