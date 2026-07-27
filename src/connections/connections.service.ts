import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gerencia as credenciais das integracoes POR ORGANIZACAO (multi-tenant).
 *
 * Fallback global: se a organizacao ainda nao conectou a propria conta, as
 * credenciais do .env podem ser usadas — mas SOMENTE pela organizacao dona da
 * instalacao (`OWNER_ORGANIZATION_ID`). Sem essa restricao, qualquer contato
 * novo (que vira uma organizacao automaticamente em `TenantService`) herdaria
 * as credenciais globais e conseguiria ler o Gmail/Drive/CRM/financeiro do dono.
 *
 * DEV: credenciais guardadas em texto. PRODUCAO: criptografar.
 */
@Injectable()
export class ConnectionsService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Avisa uma unica vez, no boot, se o fallback global esta desativado. */
  onModuleInit(): void {
    if (!this.ownerOrganizationId()) {
      this.logger.warn(
        'OWNER_ORGANIZATION_ID nao configurado: o fallback para as credenciais ' +
          'globais do .env esta DESATIVADO. Cada organizacao precisa conectar ' +
          'as proprias contas.',
      );
    }
  }

  /**
   * Organizacao dona da instalacao — a unica autorizada a usar as credenciais
   * globais do .env. Ausente/vazio significa "ninguem" (fail-closed).
   */
  private ownerOrganizationId(): string | undefined {
    const raw = this.config.get<string>('OWNER_ORGANIZATION_ID')?.trim();
    return raw ? raw : undefined;
  }

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
   *  2) senao, o token global do .env — apenas se a organizacao for a dona;
   *  3) senao, `undefined` (a ferramenta responde "nao conectado").
   */
  async resolveToken(
    context: { organizationId?: string } | undefined,
    provider: string,
    envKey: string,
  ): Promise<string | undefined> {
    const organizationId = context?.organizationId;

    // 1. Credencial da propria organizacao tem sempre precedencia.
    if (organizationId) {
      const conn = await this.get(organizationId, provider);
      const token = (conn?.credentials as any)?.token;
      if (token) return token;
    }

    // 2. Fallback global, restrito a organizacao dona da instalacao.
    const owner = this.ownerOrganizationId();
    if (!owner || organizationId !== owner) {
      this.logger.debug(
        `Sem conexao propria para "${provider}" na organizacao ` +
          `${organizationId ?? '(sem contexto)'}; fallback global negado.`,
      );
      return undefined;
    }

    return this.config.get<string>(envKey);
  }
}
