import { PainelTools } from './painel.tools';
import { PainelService } from './painel.service';
import { SheetsService } from '../integrations/google/sheets.service';
import { GoogleService } from '../integrations/google/google.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { AgentTool } from '../tools/tool.interface';
import { SerieError } from './serie';

/**
 * O que precisa ficar travado aqui: um grafico so entra no painel se ele
 * REALMENTE renderizar. Quem escolheu as colunas foi a IA, nao o cliente —
 * entao um card quebrado e um problema que o cliente nao tem como consertar
 * sozinho, e ele so descobriria ao abrir o painel.
 */
describe('PainelTools', () => {
  const contexto = { organizationId: 'org-1' };

  function montar(painel: Partial<PainelService>) {
    const registradas = new Map<string, AgentTool>();
    const registry = {
      register: (t: AgentTool) => registradas.set(t.definition.name, t),
    } as unknown as ToolRegistryService;

    const google = { isConfigured: () => true } as unknown as GoogleService;

    const tools = new PainelTools(
      registry,
      painel as PainelService,
      SheetsService.prototype as SheetsService,
      google,
    );
    tools.onModuleInit();

    return registradas;
  }

  const previaBoa = {
    pontos: [
      { rotulo: 'jul/2026', valor: 900 },
      { rotulo: 'ago/2026', valor: 1500 },
    ],
    linhasLidas: 10,
    linhasIgnoradas: 0,
  };

  const entrada = {
    titulo: 'Vendas por mês',
    planilha_id: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
    coluna_rotulo: 'Data',
    coluna_valor: 'Valor',
  };

  it('exige confirmacao antes de gravar (e ferramenta de escrita)', () => {
    const tools = montar({});
    expect(tools.get('painel_criar_grafico')?.escrita).toBe(true);
    expect(tools.get('painel_remover_grafico')?.escrita).toBe(true);
    // Listar e leitura pura: pedir confirmacao so treina o usuario a dizer sim.
    expect(tools.get('painel_listar_graficos')?.escrita).toBeUndefined();
  });

  it('nao salva quando o mapeamento nao produz nenhum ponto', async () => {
    const criarCard = jest.fn();
    const tools = montar({
      listarCards: jest.fn().mockResolvedValue([]),
      previsualizar: jest
        .fn()
        .mockResolvedValue({ pontos: [], linhasLidas: 40, linhasIgnoradas: 40 }),
      criarCard,
    });

    const r = await tools.get('painel_criar_grafico')!.execute(entrada, contexto);

    expect(criarCard).not.toHaveBeenCalled();
    expect(r).toContain('Nao criei o grafico');
    // A resposta precisa dar o numero, senao a IA nao consegue explicar o que houve.
    expect(r).toContain('40');
  });

  it('nao salva quando a leitura da planilha falha', async () => {
    const criarCard = jest.fn();
    const tools = montar({
      listarCards: jest.fn().mockResolvedValue([]),
      previsualizar: jest
        .fn()
        .mockRejectedValue(new SerieError('A coluna "Valor" não existe mais.')),
      criarCard,
    });

    const r = await tools.get('painel_criar_grafico')!.execute(entrada, contexto);

    expect(criarCard).not.toHaveBeenCalled();
    expect(r).toContain('não existe mais');
  });

  it('salva quando a previa tem dados, e devolve numeros reais', async () => {
    const criarCard = jest.fn().mockResolvedValue({
      id: 'c1',
      titulo: 'Vendas por mês',
    });
    const tools = montar({
      listarCards: jest.fn().mockResolvedValue([]),
      previsualizar: jest.fn().mockResolvedValue(previaBoa),
      criarCard,
    });

    const r = await tools.get('painel_criar_grafico')!.execute(entrada, contexto);

    expect(criarCard).toHaveBeenCalledTimes(1);
    // "Criei o grafico" sem dado deixaria o cliente sem saber se ficou certo.
    expect(r).toContain('ago/2026');
    expect(r).toContain('1.500');
  });

  it('extrai o ID da planilha quando a IA passa a URL inteira', async () => {
    const criarCard = jest.fn().mockResolvedValue({ id: 'c1', titulo: 'x' });
    const previsualizar = jest.fn().mockResolvedValue(previaBoa);
    const tools = montar({
      listarCards: jest.fn().mockResolvedValue([]),
      previsualizar,
      criarCard,
    });

    await tools.get('painel_criar_grafico')!.execute(entrada, contexto);

    expect(previsualizar).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ planilhaId: 'ABC123' }),
    );
  });

  it('cai no padrao quando a IA manda uma opcao invalida', async () => {
    const previsualizar = jest.fn().mockResolvedValue(previaBoa);
    const criarCard = jest.fn().mockResolvedValue({ id: 'c1', titulo: 'x' });
    const tools = montar({
      listarCards: jest.fn().mockResolvedValue([]),
      previsualizar,
      criarCard,
    });

    await tools.get('painel_criar_grafico')!.execute(
      { ...entrada, agregacao: 'mediana', tipo: 'pizza', agrupar_por: 'semana' },
      contexto,
    );

    // Valor invalido nao pode virar undefined e quebrar o card depois.
    expect(previsualizar).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ agregacao: 'soma', agruparPor: 'mes' }),
    );
    expect(criarCard).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ tipo: 'barra' }),
    );
  });

  it('avisa quando linhas foram ignoradas', async () => {
    const tools = montar({
      listarCards: jest.fn().mockResolvedValue([]),
      previsualizar: jest.fn().mockResolvedValue({
        ...previaBoa,
        linhasLidas: 10,
        linhasIgnoradas: 3,
      }),
      criarCard: jest.fn().mockResolvedValue({ id: 'c1', titulo: 'x' }),
    });

    const r = await tools.get('painel_criar_grafico')!.execute(entrada, contexto);

    // Grafico que descartou linhas em silencio e um grafico mentiroso.
    expect(r).toContain('3 de 10');
  });

  it('respeita o teto de cards', async () => {
    const criarCard = jest.fn();
    const tools = montar({
      listarCards: jest.fn().mockResolvedValue(new Array(12).fill({})),
      criarCard,
    });

    const r = await tools.get('painel_criar_grafico')!.execute(entrada, contexto);

    expect(criarCard).not.toHaveBeenCalled();
    expect(r).toContain('limite');
  });

  it('recusa execucao sem organizacao — nunca grava sem tenant', async () => {
    const criarCard = jest.fn();
    const tools = montar({ criarCard });

    const r = await tools.get('painel_criar_grafico')!.execute(entrada, {});

    expect(criarCard).not.toHaveBeenCalled();
    expect(r).toContain('organizacao');
  });

  describe('painel_adicionar_indicador', () => {
    function comIndicadores(extra: Partial<PainelService> = {}) {
      const criarIndicador = jest
        .fn()
        .mockResolvedValue({ id: 'c1', titulo: 'Seguidores no Instagram' });
      const tools = montar({
        listarCards: jest.fn().mockResolvedValue([]),
        provedoresConectados: jest
          .fn()
          .mockResolvedValue(['instagram', 'hubspot']),
        criarIndicador,
        ...extra,
      });
      return { tools, criarIndicador };
    }

    it('salva o indicador do catalogo com a chave da serie', async () => {
      const { tools, criarIndicador } = comIndicadores();

      await tools.get('painel_adicionar_indicador')!.execute(
        { indicador: 'instagram_seguidores' },
        contexto,
      );

      expect(criarIndicador).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          fonte: 'metrica_historica',
          tipo: 'linha',
          config: { chave: 'instagram.seguidores', dias: 90 },
        }),
      );
    });

    it('avisa que o historico comeca na conexao — nao promete o passado', async () => {
      // O Instagram nao informa quantos seguidores havia mes passado. Prometer
      // um grafico cheio para quem conectou ontem seria mentira.
      const { tools } = comIndicadores();

      const r = await tools.get('painel_adicionar_indicador')!.execute(
        { indicador: 'instagram_seguidores' },
        contexto,
      );

      expect(r).toContain('nao da');
      expect(r).toContain('recuperar o periodo anterior');
    });

    it('nao avisa sobre historico num card ao vivo', async () => {
      const { tools } = comIndicadores();

      const r = await tools.get('painel_adicionar_indicador')!.execute(
        { indicador: 'hubspot_funil' },
        contexto,
      );

      expect(r).not.toContain('recuperar o periodo anterior');
    });

    it('recusa quando a integracao nao esta conectada', async () => {
      // Card sem conexao nasceria mostrando erro; barrar aqui deixa a IA
      // orientar o cliente a conectar, o que resolve de verdade.
      const { tools, criarIndicador } = comIndicadores({
        provedoresConectados: jest.fn().mockResolvedValue(['hubspot']),
      });

      const r = await tools.get('painel_adicionar_indicador')!.execute(
        { indicador: 'instagram_alcance' },
        contexto,
      );

      expect(criarIndicador).not.toHaveBeenCalled();
      expect(r).toContain('instagram');
      expect(r).toContain('Integracoes');
    });

    it('recusa indicador que nao existe no catalogo', async () => {
      const { tools, criarIndicador } = comIndicadores();

      const r = await tools.get('painel_adicionar_indicador')!.execute(
        { indicador: 'tiktok_seguidores' },
        contexto,
      );

      expect(criarIndicador).not.toHaveBeenCalled();
      expect(r).toContain('nao existe');
    });

    it('aceita janela e titulo personalizados', async () => {
      const { tools, criarIndicador } = comIndicadores();

      await tools.get('painel_adicionar_indicador')!.execute(
        { indicador: 'instagram_alcance', dias: 30, titulo: 'Meu alcance' },
        contexto,
      );

      expect(criarIndicador).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          titulo: 'Meu alcance',
          config: expect.objectContaining({ dias: 30 }),
        }),
      );
    });

    it('e ferramenta de escrita', () => {
      const { tools } = comIndicadores();
      expect(tools.get('painel_adicionar_indicador')?.escrita).toBe(true);
    });
  });

  it('remove pelo numero da lista e valida o intervalo', async () => {
    const removerCard = jest.fn();
    const tools = montar({
      listarCards: jest
        .fn()
        .mockResolvedValue([{ id: 'a', titulo: 'Um' }, { id: 'b', titulo: 'Dois' }]),
      removerCard,
    });
    const remover = tools.get('painel_remover_grafico')!;

    await remover.execute({ numero: 2 }, contexto);
    expect(removerCard).toHaveBeenCalledWith('org-1', 'b');

    removerCard.mockClear();
    const fora = await remover.execute({ numero: 9 }, contexto);
    expect(removerCard).not.toHaveBeenCalled();
    expect(fora).toContain('invalido');
  });
});
