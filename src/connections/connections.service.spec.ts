import { ConfigService } from '@nestjs/config';
import { ConnectionsService } from './connections.service';
import { PrismaService } from '../prisma/prisma.service';
import { cifrar, carregarChave, estaCifrado } from './credentials-crypto';

/**
 * Resolucao de credenciais entre organizacoes.
 *
 * O bug que estes testes impedem de voltar: antes, uma organizacao sem conexao
 * propria caia no token global do .env. Como todo contato novo vira uma
 * organizacao automaticamente, qualquer desconhecido herdava o Gmail, o CRM e o
 * financeiro do dono. A correcao restringiu o fallback a organizacao dona.
 */
describe('ConnectionsService', () => {
  const CHAVE = 'c'.repeat(64);
  const ORG_DONA = 'org-do-dono';
  const ORG_CLIENTE = 'org-de-um-cliente';

  const configFalso = (extra: Record<string, string> = {}) =>
    ({
      get: (chave: string) =>
        ({
          CONNECTION_ENCRYPTION_KEY: CHAVE,
          OWNER_ORGANIZATION_ID: ORG_DONA,
          HUBSPOT_ACCESS_TOKEN: 'token-global-do-dono',
          ...extra,
        })[chave],
    }) as unknown as ConfigService;

  /** Prisma falso: devolve conexao apenas para os pares registrados. */
  const prismaFalso = (conexoes: Record<string, any> = {}) =>
    ({
      connection: {
        findUnique: jest.fn(async ({ where }: any) => {
          const chave = `${where.organizationId_provider.organizationId}:${where.organizationId_provider.provider}`;
          return conexoes[chave] ?? null;
        }),
        upsert: jest.fn(async ({ create }: any) => create),
        deleteMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => Object.values(conexoes)),
      },
    }) as unknown as PrismaService;

  describe('resolveToken — isolamento entre organizacoes', () => {
    it('a organizacao dona usa o token global do .env', async () => {
      const s = new ConnectionsService(prismaFalso(), configFalso());
      const token = await s.resolveToken(
        { organizationId: ORG_DONA },
        'hubspot',
        'HUBSPOT_ACCESS_TOKEN',
      );
      expect(token).toBe('token-global-do-dono');
    });

    it('OUTRA organizacao NAO herda o token global', async () => {
      const s = new ConnectionsService(prismaFalso(), configFalso());
      const token = await s.resolveToken(
        { organizationId: ORG_CLIENTE },
        'hubspot',
        'HUBSPOT_ACCESS_TOKEN',
      );
      expect(token).toBeUndefined();
    });

    it('sem contexto de organizacao, nao entrega credencial', async () => {
      const s = new ConnectionsService(prismaFalso(), configFalso());
      expect(
        await s.resolveToken(undefined, 'hubspot', 'HUBSPOT_ACCESS_TOKEN'),
      ).toBeUndefined();
    });

    it('sem OWNER_ORGANIZATION_ID, ninguem usa o global (fail-closed)', async () => {
      const s = new ConnectionsService(
        prismaFalso(),
        configFalso({ OWNER_ORGANIZATION_ID: '' }),
      );
      expect(
        await s.resolveToken(
          { organizationId: ORG_DONA },
          'hubspot',
          'HUBSPOT_ACCESS_TOKEN',
        ),
      ).toBeUndefined();
    });

    it('a credencial da propria organizacao tem precedencia sobre o global', async () => {
      const chave = carregarChave(CHAVE)!;
      const s = new ConnectionsService(
        prismaFalso({
          [`${ORG_DONA}:hubspot`]: {
            credentials: cifrar({ token: 'token-proprio' }, chave),
          },
        }),
        configFalso(),
      );

      const token = await s.resolveToken(
        { organizationId: ORG_DONA },
        'hubspot',
        'HUBSPOT_ACCESS_TOKEN',
      );
      expect(token).toBe('token-proprio');
    });

    it('cada organizacao recebe a propria credencial', async () => {
      const chave = carregarChave(CHAVE)!;
      const s = new ConnectionsService(
        prismaFalso({
          [`${ORG_DONA}:asaas`]: { credentials: cifrar({ token: 'do-dono' }, chave) },
          [`${ORG_CLIENTE}:asaas`]: {
            credentials: cifrar({ token: 'do-cliente' }, chave),
          },
        }),
        configFalso(),
      );

      expect(
        await s.resolveToken({ organizationId: ORG_DONA }, 'asaas', 'ASAAS_API_KEY'),
      ).toBe('do-dono');
      expect(
        await s.resolveToken({ organizationId: ORG_CLIENTE }, 'asaas', 'ASAAS_API_KEY'),
      ).toBe('do-cliente');
    });
  });

  describe('set', () => {
    it('grava a credencial cifrada, nunca em claro', async () => {
      const prisma = prismaFalso();
      const s = new ConnectionsService(prisma, configFalso());

      await s.set(ORG_CLIENTE, 'stripe', { token: 'sk_live_do_cliente' });

      const gravado = (prisma.connection.upsert as jest.Mock).mock.calls[0][0]
        .create.credentials;
      expect(estaCifrado(gravado)).toBe(true);
      expect(JSON.stringify(gravado)).not.toContain('sk_live_do_cliente');
    });

    it('recusa gravar se nao houver chave de criptografia', async () => {
      const s = new ConnectionsService(
        prismaFalso(),
        configFalso({ CONNECTION_ENCRYPTION_KEY: '' }),
      );
      // Falhar alto e melhor do que gravar em claro sem ninguem perceber.
      await expect(s.set(ORG_CLIENTE, 'stripe', { token: 'x' })).rejects.toThrow();
    });
  });

  describe('get', () => {
    it('aceita registro legado em texto plano durante a migracao', async () => {
      const s = new ConnectionsService(
        prismaFalso({
          [`${ORG_DONA}:hubspot`]: { credentials: { token: 'antigo-em-claro' } },
        }),
        configFalso(),
      );

      const conn = await s.get(ORG_DONA, 'hubspot');
      expect((conn?.credentials as any).token).toBe('antigo-em-claro');
    });
  });
});
