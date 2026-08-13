import { ColetorMetricasService } from './coletor-metricas.service';
import { MetricaService } from './metrica.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { InstagramService } from '../integrations/instagram/instagram.service';
import { HubspotService } from '../integrations/hubspot/hubspot.service';

/**
 * O que precisa ficar travado aqui: a coleta NUNCA pode parar no meio.
 *
 * Cada falha silenciosa e um ponto que nunca mais vai existir no grafico do
 * cliente — o Instagram nao diz quantos seguidores ele tinha na terca passada.
 * Um cliente com token vencido nao pode virar buraco no historico de todos.
 */
describe('ColetorMetricasService', () => {
  function montar(opcoes: {
    orgs?: { id: string; name: string; demo: boolean }[];
    tokens?: Record<string, string | undefined>;
    perfil?: unknown;
    metricas?: unknown;
    funil?: unknown;
  }) {
    const registradas: { org: string; chave: string; valor: number }[] = [];

    const prisma = {
      organization: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            opcoes.orgs ?? [{ id: 'org-1', name: 'A', demo: false }],
          ),
      },
    } as unknown as PrismaService;

    const connections = {
      resolveToken: jest.fn(async (ctx, provedor) => {
        const t = opcoes.tokens ?? { instagram: 'tk-ig', hubspot: 'tk-hs' };
        const valor = t[provedor];
        if (valor === 'ERRO') throw new Error('credencial ilegivel');
        return valor;
      }),
    } as unknown as ConnectionsService;

    const metricas = {
      registrar: jest.fn(async (org: string, chave: string, valor: number) => {
        registradas.push({ org, chave, valor });
      }),
    } as unknown as MetricaService;

    const instagram = {
      getPerfil: jest.fn(async () => {
        if (opcoes.perfil instanceof Error) throw opcoes.perfil;
        return opcoes.perfil ?? { seguidores: 1200, publicacoes: 48 };
      }),
      getMetricas: jest.fn(async () => opcoes.metricas ?? {}),
    } as unknown as InstagramService;

    const hubspot = {
      resumoDoFunil: jest.fn(async () => {
        if (opcoes.funil instanceof Error) throw opcoes.funil;
        return (
          opcoes.funil ?? {
            porEstagio: new Map([
              ['novo', { quantidade: 3, valor: 15000 }],
              ['fechado', { quantidade: 1, valor: 5000 }],
            ]),
            total: 4,
            truncado: false,
          }
        );
      }),
    } as unknown as HubspotService;

    const servico = new ColetorMetricasService(
      prisma,
      connections,
      metricas,
      instagram,
      hubspot,
    );

    return { servico, registradas, connections, instagram, hubspot };
  }

  const chaves = (r: { chave: string }[]) => r.map((x) => x.chave);

  it('grava as series de cada integracao conectada', async () => {
    const { servico, registradas } = montar({});
    await servico.coletarTudo();

    expect(chaves(registradas)).toEqual(
      expect.arrayContaining([
        'instagram.seguidores',
        'instagram.publicacoes',
        'hubspot.negocios',
        'hubspot.funil.valor',
      ]),
    );
  });

  it('soma o valor do funil inteiro, nao so o primeiro estagio', async () => {
    const { servico, registradas } = montar({});
    const valor = registradas;
    await servico.coletarTudo();

    expect(valor.find((r) => r.chave === 'hubspot.funil.valor')?.valor).toBe(
      20000,
    );
    expect(valor.find((r) => r.chave === 'hubspot.negocios')?.valor).toBe(4);
  });

  it('nao grava metrica de insight ausente como zero', async () => {
    // Ausente e diferente de zero: gravar 0 desenharia uma queda a pique que
    // nao aconteceu.
    const { servico, registradas } = montar({ metricas: {} });
    await servico.coletarTudo();

    expect(chaves(registradas)).not.toContain('instagram.alcance');
    expect(chaves(registradas)).not.toContain('instagram.visualizacoes');
  });

  it('grava o insight quando ele vem', async () => {
    const { servico, registradas } = montar({
      metricas: { alcance: 890, visualizacoes: 2400, interacoes: 55 },
    });
    await servico.coletarTudo();

    expect(registradas.find((r) => r.chave === 'instagram.alcance')?.valor).toBe(
      890,
    );
  });

  it('pede a janela de 1 dia ao Instagram', async () => {
    // Janela maior sobreporia o ponto de ontem e inflaria a serie.
    const { servico, instagram } = montar({});
    await servico.coletarTudo();

    expect(instagram.getMetricas).toHaveBeenCalledWith('tk-ig', 1);
  });

  it('uma integracao quebrada nao impede a outra', async () => {
    const { servico, registradas } = montar({
      perfil: new Error('token do Instagram expirou'),
    });
    await servico.coletarTudo();

    expect(chaves(registradas)).not.toContain('instagram.seguidores');
    // O HubSpot da MESMA organizacao continua sendo coletado.
    expect(chaves(registradas)).toContain('hubspot.funil.valor');
  });

  it('uma organizacao quebrada nao impede as outras', async () => {
    const { servico, registradas } = montar({
      orgs: [
        { id: 'org-1', name: 'A', demo: false },
        { id: 'org-2', name: 'B', demo: false },
      ],
      funil: new Error('HubSpot fora do ar'),
    });
    await servico.coletarTudo();

    const orgs = new Set(registradas.map((r) => r.org));
    expect(orgs).toEqual(new Set(['org-1', 'org-2']));
  });

  it('credencial ilegivel nao derruba a coleta', async () => {
    const { servico, registradas } = montar({
      tokens: { instagram: 'ERRO', hubspot: 'tk-hs' },
    });

    await expect(servico.coletarTudo()).resolves.toBeDefined();
    expect(chaves(registradas)).toContain('hubspot.funil.valor');
  });

  it('integracao nao conectada e ignorada em silencio', async () => {
    // Nao ter Instagram nao e falha: o cliente so nao usa.
    const { servico, registradas, instagram } = montar({
      tokens: { instagram: undefined, hubspot: 'tk-hs' },
    });
    await servico.coletarTudo();

    expect(instagram.getPerfil).not.toHaveBeenCalled();
    expect(chaves(registradas)).toContain('hubspot.negocios');
  });

  it('pula organizacao de demonstracao', async () => {
    // Numero ficticio no historico viraria grafico ficticio.
    const { servico, registradas } = montar({
      orgs: [{ id: 'org-demo', name: 'Demo', demo: true }],
    });
    const r = await servico.coletarTudo();

    expect(registradas).toHaveLength(0);
    expect(r.series).toBe(0);
  });
});

describe('MetricaService.diaDeHoje', () => {
  it('devolve meia-noite UTC do dia corrente em Sao Paulo', () => {
    // A coleta roda as 3h da manha no Brasil (06:00 UTC). Usando a data do
    // processo em producao (UTC), o ponto cairia no dia certo por sorte; mas
    // as 22h no Brasil ja e o dia seguinte em UTC, e a serie escorregaria.
    const noite = new Date('2026-08-13T02:30:00.000Z'); // 23:30 de 12/08 em SP
    expect(MetricaService.diaDeHoje(noite).toISOString()).toBe(
      '2026-08-12T00:00:00.000Z',
    );
  });

  it('vira o dia no horario certo', () => {
    const madrugada = new Date('2026-08-13T06:10:00.000Z'); // 03:10 de 13/08 em SP
    expect(MetricaService.diaDeHoje(madrugada).toISOString()).toBe(
      '2026-08-13T00:00:00.000Z',
    );
  });
});
