import { ToolRegistryService } from './tool-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTool } from './tool.interface';

/**
 * Audiencia das ferramentas.
 *
 * Este e o mecanismo que impede um cliente do cliente (ex: alguem que manda
 * Direct no Instagram) de pedir "qual o saldo bancario?" e receber os dados do
 * dono. Duas garantias: a ferramenta nao aparece para quem nao pode, e — mais
 * importante — ela NAO EXECUTA se chamada pelo nome mesmo assim.
 */
describe('ToolRegistryService (audiencia)', () => {
  const prismaFalso = {
    operationLog: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;

  const ferramenta = (nome: string, audience?: 'owner' | 'public'): AgentTool => ({
    definition: { name: nome, description: '', input_schema: { type: 'object' } },
    ...(audience ? { audience } : {}),
    execute: async () => `executou ${nome}`,
  });

  let registry: ToolRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new ToolRegistryService(prismaFalso);
    registry.register(ferramenta('saldo_bancario'));            // sem audiencia
    registry.register(ferramenta('crm_privado', 'owner'));
    registry.register(ferramenta('horario_da_loja', 'public'));
  });

  describe('getDefinitions', () => {
    it('o dono enxerga todas', () => {
      expect(registry.getDefinitions('owner')).toHaveLength(3);
    });

    it('o publico so enxerga as marcadas como public', () => {
      const nomes = registry.getDefinitions('public').map((d) => d.name);
      expect(nomes).toEqual(['horario_da_loja']);
    });

    it('sem audiencia informada, assume owner', () => {
      expect(registry.getDefinitions()).toHaveLength(3);
    });

    it('ferramenta sem audiencia declarada e privada (fail-closed)', () => {
      // Uma integracao nova nasce privada. O contrario faria qualquer
      // ferramenta futura vazar dados por esquecimento.
      const nomes = registry.getDefinitions('public').map((d) => d.name);
      expect(nomes).not.toContain('saldo_bancario');
    });
  });

  describe('execute', () => {
    it('o dono executa qualquer ferramenta', async () => {
      const r = await registry.execute('saldo_bancario', {}, { audience: 'owner' });
      expect(r).toBe('executou saldo_bancario');
    });

    it('NEGA a execucao para o publico mesmo chamando pelo nome', async () => {
      // Filtrar a lista so esconde do modelo. A autorizacao precisa morar aqui,
      // porque o nome pode chegar por alucinacao ou injecao de prompt.
      const r = await registry.execute('saldo_bancario', {}, { audience: 'public' });
      expect(r).toContain('nao esta disponivel');
      expect(r).not.toContain('executou');
    });

    it('permite ao publico a ferramenta publica', async () => {
      const r = await registry.execute('horario_da_loja', {}, { audience: 'public' });
      expect(r).toBe('executou horario_da_loja');
    });

    it('sem contexto, trata como owner (canais atuais sao do dono)', async () => {
      expect(await registry.execute('crm_privado', {})).toBe('executou crm_privado');
    });

    it('audita a tentativa negada', async () => {
      await registry.execute('crm_privado', {}, { audience: 'public' });
      // Tentativa barrada e sinal de abuso ou injecao: precisa ficar registrada.
      expect(prismaFalso.operationLog.create).toHaveBeenCalled();
    });

    it('ferramenta inexistente nao quebra o fluxo', async () => {
      expect(await registry.execute('nao_existe', {})).toContain('nao encontrada');
    });
  });
});
