import { montarSerie, SerieError } from './serie';
import { ConfigPlanilha } from './painel.types';

/**
 * Uma planilha de vendas como um dono de PME realmente monta: titulo em cima,
 * linha em branco, valores em reais, datas em dd/mm, e uma linha com valor
 * faltando no meio.
 */
const PLANILHA = [
  ['Vendas 2026'],
  [],
  ['Data', 'Produto', 'Valor'],
  ['05/08/2026', 'Cadeira', 'R$ 1.200,00'],
  ['12/08/2026', 'Mesa', 'R$ 800,50'],
  ['03/09/2026', 'Cadeira', 'R$ 1.000,00'],
  ['15/09/2026', 'Armario', 'a combinar'],
  ['20/09/2026', 'Mesa', 'R$ 250,00'],
];

const base: ConfigPlanilha = {
  planilhaId: 'abc',
  colunaRotulo: 'Data',
  colunaValor: 'Valor',
  agregacao: 'soma',
};

describe('montarSerie', () => {
  it('agrupa por mes e soma, respeitando o cabecalho fora da linha 1', () => {
    const s = montarSerie(PLANILHA, base);

    expect(s.pontos).toEqual([
      { rotulo: 'ago/2026', valor: 2000.5, ordem: '2026-08' },
      { rotulo: 'set/2026', valor: 1250, ordem: '2026-09' },
    ]);
  });

  it('conta as linhas ignoradas em vez de escondê-las', () => {
    // Um grafico que descartou linhas em silencio e um grafico mentiroso.
    const s = montarSerie(PLANILHA, base);

    expect(s.linhasLidas).toBe(5);
    expect(s.linhasIgnoradas).toBe(1); // "a combinar"
  });

  it('marca o eixo como temporal so quando o rotulo e data', () => {
    // A tela usa isso para nao chamar "Cadeira, Mesa" de "periodos".
    expect(montarSerie(PLANILHA, base).eixoTemporal).toBe(true);
    expect(
      montarSerie(PLANILHA, { ...base, colunaRotulo: 'Produto' }).eixoTemporal,
    ).toBe(false);
  });

  it('agrupa por categoria quando o rotulo e texto, na ordem da planilha', () => {
    const s = montarSerie(PLANILHA, { ...base, colunaRotulo: 'Produto' });

    expect(s.pontos.map((p) => p.rotulo)).toEqual(['Cadeira', 'Mesa']);
    expect(s.pontos[0].valor).toBe(2200);
    expect(s.pontos[1].valor).toBe(1050.5);

    // "Armario" tinha uma linha so, com "a combinar" no valor. Ele NAO vira
    // uma barra de altura zero: isso leria como "Armario vendeu zero", que e
    // diferente de "ainda nao sei quanto foi". A linha entra na contagem de
    // ignoradas, que aparece para o cliente.
    expect(s.pontos.map((p) => p.rotulo)).not.toContain('Armario');
    expect(s.linhasIgnoradas).toBe(1);
  });

  it('ordena cronologicamente, nao alfabeticamente', () => {
    // "abr" viria antes de "jan" numa ordenacao de texto.
    const linhas = [
      ['Data', 'Valor'],
      ['10/04/2026', '1'],
      ['10/01/2026', '2'],
      ['10/12/2026', '3'],
    ];
    const s = montarSerie(linhas, { ...base, colunaValor: 'Valor' });

    expect(s.pontos.map((p) => p.rotulo)).toEqual([
      'jan/2026',
      'abr/2026',
      'dez/2026',
    ]);
  });

  it('respeita a granularidade pedida', () => {
    const porAno = montarSerie(PLANILHA, { ...base, agruparPor: 'ano' });
    expect(porAno.pontos).toHaveLength(1);
    expect(porAno.pontos[0].rotulo).toBe('2026');

    const porDia = montarSerie(PLANILHA, { ...base, agruparPor: 'dia' });
    expect(porDia.pontos[0].rotulo).toBe('05/08');
  });

  it('aplica cada agregacao', () => {
    const cfg = { ...base, colunaRotulo: 'Produto' };
    const soma = montarSerie(PLANILHA, cfg).pontos[0].valor;
    const media = montarSerie(PLANILHA, { ...cfg, agregacao: 'media' })
      .pontos[0].valor;
    const contagem = montarSerie(PLANILHA, { ...cfg, agregacao: 'contagem' })
      .pontos[0].valor;
    const maximo = montarSerie(PLANILHA, { ...cfg, agregacao: 'maximo' })
      .pontos[0].valor;

    expect(soma).toBe(2200);
    expect(media).toBe(1100);
    expect(contagem).toBe(2);
    expect(maximo).toBe(1200);
  });

  it('corta pelo fim: "ultimos N" sao os mais recentes', () => {
    const s = montarSerie(PLANILHA, { ...base, limitePontos: 1 });
    expect(s.pontos.map((p) => p.rotulo)).toEqual(['set/2026']);
  });

  it('casa a coluna ignorando acento, caixa e espaco', () => {
    // O cliente troca "Valor" por "valor " sem achar que mudou algo — e do
    // ponto de vista dele nao mudou.
    const linhas = [
      ['  DATA ', 'Endereço'],
      ['05/08/2026', '10'],
    ];
    const s = montarSerie(linhas, {
      ...base,
      colunaRotulo: 'data',
      colunaValor: 'endereco',
    });

    expect(s.pontos[0].valor).toBe(10);
  });

  it('explica ao cliente quando a coluna sumiu, em vez de devolver vazio', () => {
    expect(() =>
      montarSerie(PLANILHA, { ...base, colunaValor: 'Faturamento' }),
    ).toThrow(SerieError);

    try {
      montarSerie(PLANILHA, { ...base, colunaValor: 'Faturamento' });
    } catch (e) {
      // A mensagem precisa dizer o que existe, senao o cliente nao consegue agir.
      expect((e as Error).message).toContain('Faturamento');
      expect((e as Error).message).toContain('Valor');
    }
  });

  it('avisa quando nao ha cabecalho reconhecivel', () => {
    expect(() => montarSerie([['1', '2']], base)).toThrow(SerieError);
  });

  it('ignora linhas totalmente vazias sem conta-las como perdidas', () => {
    // Linha em branco no meio e separador visual, nao dado faltando.
    const linhas = [
      ['Data', 'Valor'],
      ['05/08/2026', '10'],
      [],
      ['', ''],
      ['06/08/2026', '20'],
    ];
    const s = montarSerie(linhas, base);

    expect(s.linhasLidas).toBe(2);
    expect(s.linhasIgnoradas).toBe(0);
    expect(s.pontos[0].valor).toBe(30);
  });

  it('aguenta planilha so com cabecalho', () => {
    const s = montarSerie([['Data', 'Valor']], base);
    expect(s.pontos).toEqual([]);
    expect(s.linhasLidas).toBe(0);
  });
});
