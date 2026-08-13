import {
  celulaVazia,
  classificarColuna,
  detectarCabecalho,
  interpretarData,
  interpretarNumero,
} from './planilha-parser';

/**
 * Estes testes sao a defesa contra o pior defeito desta feature: o grafico que
 * mostra um numero errado com cara de certo. Cada caso aqui saiu de um formato
 * que aparece de verdade em planilha de PME brasileira.
 */
describe('interpretarNumero', () => {
  it('le moeda brasileira', () => {
    expect(interpretarNumero('R$ 1.234,56')).toBe(1234.56);
    expect(interpretarNumero('R$1.234,56')).toBe(1234.56);
    expect(interpretarNumero('1.234,56')).toBe(1234.56);
  });

  it('le o formato americano, que aparece em planilha exportada de fora', () => {
    expect(interpretarNumero('1,234.56')).toBe(1234.56);
    expect(interpretarNumero('12,345,678.90')).toBe(12345678.9);
  });

  it('trata virgula sozinha como decimal', () => {
    expect(interpretarNumero('1,5')).toBe(1.5);
    expect(interpretarNumero('0,99')).toBe(0.99);
  });

  it('trata ponto com 3 digitos como milhar — o caso ambiguo', () => {
    // "1.500" numa planilha brasileira e mil e quinhentos. Se um dia isso
    // mudar, e este teste que precisa ser reescrito conscientemente.
    expect(interpretarNumero('1.500')).toBe(1500);
    expect(interpretarNumero('1.234.567')).toBe(1234567);
  });

  it('trata ponto com 1 ou 2 digitos como decimal', () => {
    expect(interpretarNumero('1.5')).toBe(1.5);
    expect(interpretarNumero('10.25')).toBe(10.25);
  });

  it('entende negativo com sinal e entre parenteses', () => {
    expect(interpretarNumero('-300,50')).toBe(-300.5);
    expect(interpretarNumero('(300,50)')).toBe(-300.5);
    expect(interpretarNumero('R$ (1.000,00)')).toBe(-1000);
  });

  it('converte percentual para fracao', () => {
    expect(interpretarNumero('12%')).toBeCloseTo(0.12);
    expect(interpretarNumero('7,5%')).toBeCloseTo(0.075);
  });

  it('devolve null para vazio, em vez de zero', () => {
    // Vazio e "vendeu zero" sao fatos diferentes: somar vazio como zero
    // estragaria media e minimo.
    expect(interpretarNumero('')).toBeNull();
    expect(interpretarNumero('   ')).toBeNull();
    expect(interpretarNumero(null)).toBeNull();
    expect(interpretarNumero(undefined)).toBeNull();
  });

  it('devolve null para texto que nao e numero', () => {
    expect(interpretarNumero('a definir')).toBeNull();
    expect(interpretarNumero('Joao da Silva')).toBeNull();
    expect(interpretarNumero('-')).toBeNull();
    expect(interpretarNumero('N/A')).toBeNull();
  });

  it('aceita numero nativo, que vem quando a celula tem formula', () => {
    expect(interpretarNumero(42)).toBe(42);
    expect(interpretarNumero(0)).toBe(0);
    expect(interpretarNumero(NaN)).toBeNull();
    expect(interpretarNumero(Infinity)).toBeNull();
  });
});

describe('interpretarData', () => {
  it('le o formato brasileiro como dia/mes — nunca mes/dia', () => {
    // Ler 05/08 como 8 de maio jogaria a venda para outro mes no grafico.
    const d = interpretarData('05/08/2026')!;
    expect(d.getUTCDate()).toBe(5);
    expect(d.getUTCMonth()).toBe(7); // agosto
    expect(d.getUTCFullYear()).toBe(2026);
  });

  it('aceita separadores com ponto e hifen', () => {
    expect(interpretarData('05-08-2026')!.getUTCDate()).toBe(5);
    expect(interpretarData('05.08.2026')!.getUTCMonth()).toBe(7);
  });

  it('aceita ISO', () => {
    const d = interpretarData('2026-08-05')!;
    expect(d.getUTCMonth()).toBe(7);
    expect(d.getUTCDate()).toBe(5);
  });

  it('completa ano de 2 digitos para 20xx', () => {
    expect(interpretarData('05/08/26')!.getUTCFullYear()).toBe(2026);
  });

  it('constroi em UTC para o agrupamento por mes nao escorregar', () => {
    // Com fuso local, 01/08 no Brasil viraria 31/07 em UTC e a venda mudaria
    // de mes no grafico.
    const d = interpretarData('01/08/2026')!;
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('rejeita data que nao existe, em vez de deixar o Date corrigir', () => {
    // new Date(2026, 1, 31) vira 03/03 em silencio.
    expect(interpretarData('31/02/2026')).toBeNull();
    expect(interpretarData('32/01/2026')).toBeNull();
    expect(interpretarData('05/13/2026')).toBeNull();
  });

  it('devolve null para vazio e para texto', () => {
    expect(interpretarData('')).toBeNull();
    expect(interpretarData('a combinar')).toBeNull();
    expect(interpretarData(null)).toBeNull();
  });
});

describe('celulaVazia', () => {
  it('reconhece as formas de vazio que a planilha produz', () => {
    expect(celulaVazia('')).toBe(true);
    expect(celulaVazia('  ')).toBe(true);
    expect(celulaVazia(null)).toBe(true);
    expect(celulaVazia(undefined)).toBe(true);
    expect(celulaVazia('0')).toBe(false);
    expect(celulaVazia(0)).toBe(false);
  });
});

describe('detectarCabecalho', () => {
  it('pula titulo e linhas em branco no topo', () => {
    const linhas = [
      ['Relatorio de Vendas 2026'],
      [],
      ['', '', ''],
      ['Data', 'Produto', 'Valor'],
      ['05/08/2026', 'Cadeira', 'R$ 1.200,00'],
    ];

    const cab = detectarCabecalho(linhas)!;
    expect(cab.linha).toBe(3);
    expect(cab.colunas).toEqual(['Data', 'Produto', 'Valor']);
  });

  it('funciona quando o cabecalho esta em A1', () => {
    const cab = detectarCabecalho([
      ['Mes', 'Meta', 'Realizado'],
      ['Janeiro', '1000', '900'],
    ])!;
    expect(cab.linha).toBe(0);
  });

  it('nao confunde linha de dado com cabecalho', () => {
    // A linha de dado tem numero; cabecalho e so rotulo.
    const cab = detectarCabecalho([
      ['05/08/2026', 'Cadeira', '1200'],
      ['Data', 'Produto', 'Valor'],
    ])!;
    expect(cab.linha).toBe(1);
  });

  it('nomeia coluna sem titulo em vez de devolver string vazia', () => {
    const cab = detectarCabecalho([['Data', '', 'Valor']])!;
    expect(cab.colunas).toEqual(['Data', 'Coluna 2', 'Valor']);
  });

  it('devolve null quando nao ha cabecalho reconhecivel', () => {
    expect(detectarCabecalho([])).toBeNull();
    expect(detectarCabecalho([['1'], ['2']])).toBeNull();
  });
});

describe('classificarColuna', () => {
  it('classifica valores como numero', () => {
    expect(classificarColuna(['R$ 10,00', '1.200,50', '99'])).toBe('numero');
  });

  it('classifica datas como data', () => {
    expect(classificarColuna(['05/08/2026', '06/08/2026'])).toBe('data');
  });

  it('classifica nomes como texto', () => {
    expect(classificarColuna(['Joao', 'Maria', 'Cadeira'])).toBe('texto');
  });

  it('tolera uma celula fora do padrao — maioria simples', () => {
    // Exigir unanimidade faria um "a definir" desqualificar a coluna inteira.
    expect(classificarColuna(['05/08/2026', 'a definir', '07/08/2026'])).toBe(
      'data',
    );
    expect(classificarColuna(['10', '20', 'nao informado', '30'])).toBe('numero');
  });

  it('ignora celulas vazias na contagem', () => {
    expect(classificarColuna(['10', '', '  ', '20'])).toBe('numero');
    expect(classificarColuna(['', '', ''])).toBe('texto');
  });

  it('prefere numero a data quando o valor passa nos dois', () => {
    // "2026" e ano e e valor. Num grafico de vendas, e valor.
    expect(classificarColuna(['2026', '2025'])).toBe('numero');
  });
});
