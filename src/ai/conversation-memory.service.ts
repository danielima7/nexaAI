import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Uma mensagem da conversa, no formato que a API do Claude espera.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Guarda o histórico de conversa por contato (número de WhatsApp).
 *
 * AGORA PERSISTENTE em PostgreSQL (Prisma) — o histórico sobrevive a
 * reinícios do backend. Antes era só RAM.
 *
 * Regras aplicadas ao montar o contexto da IA:
 *  - considera apenas mensagens dos últimos TTL_MS (janela de 24h — casa com
 *    o WhatsApp e evita misturar assuntos antigos);
 *  - usa no máximo as últimas MAX_MESSAGES mensagens (controla custo de tokens).
 * O banco mantém o histórico completo para fins de auditoria/histórico.
 */
@Injectable()
export class ConversationMemoryService {
  /** Número máximo de mensagens enviadas como contexto à IA. */
  private readonly MAX_MESSAGES = 20;

  /** Janela de tempo considerada para o contexto (24h). */
  private readonly TTL_MS = 24 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna o histórico recente do contato (últimas MAX_MESSAGES na janela).
   */
  async getHistory(userId: string): Promise<ChatMessage[]> {
    const since = new Date(Date.now() - this.TTL_MS);
    const rows = await this.prisma.message.findMany({
      where: { contact: userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: this.MAX_MESSAGES,
    });
    // Veio em ordem decrescente; invertemos para ordem cronológica.
    return rows
      .reverse()
      .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
  }

  /**
   * Persiste uma mensagem no histórico do contato.
   * @param contact numero de WhatsApp
   * @param message a mensagem (role + content)
   * @param scope organizacao/usuario (multi-tenant), opcional
   */
  async append(
    contact: string,
    message: ChatMessage,
    scope?: { organizationId?: string; userId?: string },
  ): Promise<void> {
    await this.prisma.message.create({
      data: {
        contact,
        role: message.role,
        content: message.content,
        organizationId: scope?.organizationId,
        userId: scope?.userId,
      },
    });
  }

  /**
   * Apaga o histórico de um contato (ex: comando "reiniciar conversa").
   */
  async reset(userId: string): Promise<void> {
    await this.prisma.message.deleteMany({ where: { contact: userId } });
  }
}
