import { LinkedinTools } from './linkedin.tools';
import { LinkedinService } from './linkedin.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { AgentTool } from '../../tools/tool.interface';

/**
 * Publicar no LinkedIn e a acao mais publica que o Katalli executa: o post
 * aparece no feed de terceiros no instante seguinte. Estes testes travam o que
 * protege o cliente disso — a confirmacao obrigatoria e as recusas antes de
 * chamar a API.
 */
describe('LinkedinTools', () => {
  const contexto = { organizationId: 'org-1' };

  function montar(opcoes: {
    credencial?: unknown;
    publicar?: jest.Mock;
    configurado?: boolean;
  }) {
    const registradas = new Map<string, AgentTool>();
    const registry = {
      register: (t: AgentTool) => registradas.set(t.definition.name, t),
    } as unknown as ToolRegistryService;

    const publicar =
      opcoes.publicar ?? jest.fn().mockResolvedValue('urn:li:share:123');

    const linkedin = {
      isConfigured: () => opcoes.configurado !== false,
      publicar,
    } as unknown as LinkedinService;

    const connections = {
      get: jest.fn().mockResolvedValue(
        opcoes.credencial === undefined
          ? { credentials: { token: 'tk', urn: 'urn:li:person:abc', nome: 'Daniel' } }
          : { credentials: opcoes.credencial },
      ),
    } as unknown as ConnectionsService;

    new LinkedinTools(registry, linkedin, connections).onModuleInit();
    return { tools: registradas, publicar };
  }

  it('exige confirmacao antes de publicar', () => {
    // Mesmo apagando depois, o post ja apareceu para quem viu.
    const { tools } = montar({});
    expect(tools.get('linkedin_publicar')?.escrita).toBe(true);
  });

  it('publica e confirma para quem foi visivel', async () => {
    const { tools, publicar } = montar({});
    const r = await tools
      .get('linkedin_publicar')!
      .execute({ texto: 'Fechamos mais um cliente.' }, contexto);

    expect(publicar).toHaveBeenCalledWith(
      'tk',
      'urn:li:person:abc',
      'Fechamos mais um cliente.',
      'PUBLIC',
      undefined,
    );
    expect(r).toContain('qualquer pessoa');
  });

  it('respeita a visibilidade restrita quando pedida', async () => {
    const { tools, publicar } = montar({});
    await tools
      .get('linkedin_publicar')!
      .execute({ texto: 'oi', visibilidade: 'conexoes' }, contexto);

    expect(publicar).toHaveBeenCalledWith(
      'tk',
      'urn:li:person:abc',
      'oi',
      'CONNECTIONS',
      undefined,
    );
  });

  it('visibilidade desconhecida cai em publico, nao em undefined', async () => {
    const { tools, publicar } = montar({});
    await tools
      .get('linkedin_publicar')!
      .execute({ texto: 'oi', visibilidade: 'segredo' }, contexto);

    expect(publicar.mock.calls[0][3]).toBe('PUBLIC');
  });

  it('recusa sem conexao, sem chamar a API', async () => {
    const { tools, publicar } = montar({ credencial: {} });
    const r = await tools.get('linkedin_publicar')!.execute({ texto: 'oi' }, contexto);

    expect(publicar).not.toHaveBeenCalled();
    expect(r).toContain('nao esta conectado');
  });

  it('recusa texto vazio e texto acima do limite do LinkedIn', async () => {
    const { tools, publicar } = montar({});
    const t = tools.get('linkedin_publicar')!;

    expect(await t.execute({ texto: '   ' }, contexto)).toContain('vazio');

    const longo = await t.execute({ texto: 'a'.repeat(3001) }, contexto);
    expect(longo).toContain('3000');
    expect(publicar).not.toHaveBeenCalled();
  });

  it('traduz 401 em "reconecte", nao em erro generico', async () => {
    // Token do LinkedIn vence em ~60 dias sem refresh: a acao do cliente e
    // reconectar, e a mensagem precisa dizer isso.
    const publicar = jest.fn().mockRejectedValue({ response: { status: 401 } });
    const { tools } = montar({ publicar });

    const r = await tools.get('linkedin_publicar')!.execute({ texto: 'oi' }, contexto);
    expect(r).toContain('reconectar');
  });

  it('explica o limite diario quando o LinkedIn devolve 429', async () => {
    const publicar = jest.fn().mockRejectedValue({ response: { status: 429 } });
    const { tools } = montar({ publicar });

    const r = await tools.get('linkedin_publicar')!.execute({ texto: 'oi' }, contexto);
    expect(r).toContain('150');
  });

  it('nao registra a ferramenta sem credenciais do app', async () => {
    // Sem client id/secret, oferecer a ferramenta faria a IA prometer algo
    // que falharia na hora de executar.
    const { tools } = montar({ configurado: false });
    expect(tools.has('linkedin_publicar')).toBe(false);
  });
});
