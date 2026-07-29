import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  carregarChave,
  cifrar,
  decifrar,
  estaCifrado,
} from './credentials-crypto';

/**
 * Gerencia as credenciais das integracoes POR ORGANIZACAO (multi-tenant).
 *
 * Fallback global: se a organizacao ainda nao conectou a propria conta, as
 * credenciais do .env podem ser usadas — mas SOMENTE pela organizacao dona da
 * instalacao (`OWNER_ORGANIZATION_ID`). Sem essa restricao, qualquer contato
 * novo (que vira uma organizacao automaticamente em `TenantService`) herdaria
 * as credenciais globais e conseguiria ler o Gmail/Drive/CRM/financeiro do dono.
 *
 * Credenciais em repouso: cifradas com AES-256-GCM (ver `credentials-crypto`),
 * usando `CONNECTION_ENCRYPTION_KEY`. A leitura ainda aceita registros antigos
 * em texto plano para nao quebrar durante a migracao — ver `onModuleInit`.
 */
@Injectable()
export class ConnectionsService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Diagnostico de configuracao no boot (roda uma vez). */
  async onModuleInit(): Promise<void> {
    if (!this.ownerOrganizationId()) {
      this.logger.warn(
        'OWNER_ORGANIZATION_ID nao configurado: o fallback para as credenciais ' +
          'globais do .env esta DESATIVADO. Cada organizacao precisa conectar ' +
          'as proprias contas.',
      );
    }

    if (!this.chave()) {
      this.logger.error(
        'CONNECTION_ENCRYPTION_KEY ausente ou invalida (esperado: 64 caracteres hex). ' +
          'Nenhuma credencial nova podera ser salva. Gere com: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
      return;
    }

    await this.avisarPendentesDeMigracao();
  }

  /**
   * Conta quantas conexoes ainda estao em texto plano. E so um alerta: a
   * migracao e explicita (`npm run credenciais:cifrar`), nunca automatica no
   * boot — reescrever o banco sozinho na subida e um jeito rapido de perder
   * credencial se a chave estiver errada.
   */
  private async avisarPendentesDeMigracao(): Promise<void> {
    try {
      const todas = await this.prisma.connection.findMany();
      const emClaro = todas.filter((c) => !estaCifrado(c.credentials));
      if (emClaro.length > 0) {
        this.logger.warn(
          `${emClaro.length} conexao(oes) ainda em TEXTO PLANO no banco ` +
            `(${emClaro.map((c) => c.provider).join(', ')}). ` +
            'Rode: npm run credenciais:cifrar',
        );
      }
    } catch (e: any) {
      this.logger.warn(`Nao foi possivel verificar as conexoes: ${e?.message}`);
    }
  }

  /** Chave de criptografia das credenciais (undefined = nao configurada). */
  private chave(): Buffer | undefined {
    return carregarChave(this.config.get<string>('CONNECTION_ENCRYPTION_KEY'));
  }

  /**
   * Organizacao dona da instalacao — a unica autorizada a usar as credenciais
   * globais do .env. Ausente/vazio significa "ninguem" (fail-closed).
   */
  private ownerOrganizationId(): string | undefined {
    const raw = this.config.get<string>('OWNER_ORGANIZATION_ID')?.trim();
    return raw ? raw : undefined;
  }

  /**
   * Devolve as credenciais em claro a partir do que esta guardado.
   * Aceita registros antigos em texto plano (migracao ainda pendente).
   */
  private abrir(
    credentials: any,
    provider: string,
  ): Record<string, any> | undefined {
    if (!estaCifrado(credentials)) {
      // Registro legado: ainda nao migrado. Continua utilizavel de proposito,
      // para nao derrubar integracoes que ja funcionam.
      return credentials ?? undefined;
    }

    const chave = this.chave();
    if (!chave) {
      this.logger.error(
        `Conexao "${provider}" esta cifrada mas CONNECTION_ENCRYPTION_KEY nao esta configurada.`,
      );
      return undefined;
    }

    try {
      return decifrar(credentials, chave);
    } catch (e: any) {
      this.logger.error(
        `Falha ao decifrar a conexao "${provider}": ${e?.message}. ` +
          'A chave pode ter mudado ou o registro foi adulterado.',
      );
      return undefined;
    }
  }

  /** Busca a conexao de uma organizacao, com as credenciais ja em claro. */
  async get(organizationId: string, provider: string) {
    const conn = await this.prisma.connection.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });
    if (!conn) return null;

    return {
      ...conn,
      credentials: this.abrir(conn.credentials, provider) ?? {},
    };
  }

  /** Cria/atualiza a conexao de uma organizacao, cifrando as credenciais. */
  async set(
    organizationId: string,
    provider: string,
    credentials: Record<string, any>,
  ) {
    const chave = this.chave();
    if (!chave) {
      // Falha alto: gravar em texto plano em silencio seria pior do que quebrar.
      throw new Error(
        'CONNECTION_ENCRYPTION_KEY nao configurada — nao e possivel salvar credenciais com seguranca.',
      );
    }

    const cifrado = cifrar(credentials, chave);
    return this.prisma.connection.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      create: { organizationId, provider, credentials: cifrado },
      update: { credentials: cifrado },
    });
  }

  /**
   * Remove a conexao de um provedor. O cliente pode revogar o acesso quando
   * quiser — usa `deleteMany` para ser idempotente (desconectar duas vezes
   * nao e erro).
   */
  async remover(organizationId: string, provider: string): Promise<void> {
    await this.prisma.connection.deleteMany({
      where: { organizationId, provider },
    });
    this.logger.log(
      `Conexao "${provider}" removida da organizacao ${organizationId}.`,
    );
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
