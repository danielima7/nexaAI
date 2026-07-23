import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gerencia as credenciais das integracoes POR ORGANIZACAO (multi-tenant).
 *
 * Fallback inteligente: se a organizacao ainda nao conectou a propria conta,
 * usa a credencial global do .env — assim a migracao nao quebra nada.
 *
 * DEV: credenciais guardadas em texto. PRODUCAO: criptografar.
 */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Busca a conexao de uma organizacao para um provedor. */
  async get(organizationId: string, provider: string) {
    return this.prisma.connection.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });
  }

  /** Cria/atualiza a conexao de uma organizacao para um provedor. */
  async set(
    organizationId: string,
    provider: string,
    credentials: Record<string, any>,
  ) {
    return this.prisma.connection.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      create: { organizationId, provider, credentials },
      update: { credentials },
    });
  }

  /** Lista os provedores conectados por uma organizacao. */
  async listProviders(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.connection.findMany({
      where: { organizationId },
    });
    return rows.map((r) => r.provider);
  }

  /**
   * Retorna o token efetivo para (organizacao, provedor):
   *  1) o token que a organizacao conectou (se houver);
   *  2) senao, o token global do .env (fallback).
   */
  async resolveToken(
    context: { organizationId?: string } | undefined,
    provider: string,
    envKey: string,
  ): Promise<string | undefined> {
    if (context?.organizationId) {
      const conn = await this.get(context.organizationId, provider);
      const token = (conn?.credentials as any)?.token;
      if (token) return token;
    }
    return this.config.get<string>(envKey);
  }
}
