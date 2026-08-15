import { PainelService } from './painel.service';
import { Ponto } from './painel.types';

/**
 * Cobre a logica pura que o redesenho do painel introduziu: a que secao cada
 * card pertence e qual variacao mostrar no selo. Sao numeros que aparecem em
 * destaque na tela — errar aqui e mostrar ao cliente uma queda ou uma alta que
 * nao aconteceu.
 */
describe('PainelService.moduloDoCard', () => {
  it('classifica pela fonte quando ela ja diz tudo', () => {
    expect(PainelService.moduloDoCard('planilha_google', {})).toBe('Planilhas');
    expect(PainelService.moduloDoCard('hubspot_funil', {})).toBe('CRM');
  });

  it('usa o catalogo para as series historicas', () => {
    expect(
      PainelService.moduloDoCard('metrica_historica', {
        chave: 'instagram.seguidores',
      }),
    ).toBe('Redes sociais');

    expect(
      PainelService.moduloDoCard('metrica_historica', {
        chave: 'hubspot.funil.valor',
      }),
    ).toBe('CRM');
  });

  it('cai no prefixo para serie fora do catalogo, em vez de sumir da tela', () => {
    // Uma metrica coletada por uma integracao ainda nao catalogada precisa
    // aparecer em ALGUMA secao — card invisivel e pior que card mal colocado.
    expect(
      PainelService.moduloDoCard('metrica_historica', {
        chave: 'instagram.metrica_nova',
      }),
    ).toBe('Redes sociais');
  });

  it('nao quebra com config ausente ou malformada', () => {
    expect(PainelService.moduloDoCard('metrica_historica', undefined)).toBeDefined();
    expect(PainelService.moduloDoCard('metrica_historica', null)).toBeDefined();
    expect(PainelService.moduloDoCard('fonte_desconhecida', {})).toBeDefined();
  });
});

describe('PainelService.variacao', () => {
  const p = (valores: number[]): Ponto[] =>
    valores.map((v, i) => ({ rotulo: String(i), valor: v }));

  it('calcula alta e baixa a partir do primeiro ponto', () => {
    const alta = PainelService.variacao(p([100, 150]), true, 30)!;
    expect(alta.absoluto).toBe(50);
    expect(alta.percentual).toBeCloseTo(50);

    const baixa = PainelService.variacao(p([200, 150]), true, 30)!;
    expect(baixa.absoluto).toBe(-50);
    expect(baixa.percentual).toBeCloseTo(-25);
  });

  it('compara as PONTAS da janela, ignorando o caminho no meio', () => {
    // Um pico no meio nao muda "quanto variou no periodo".
    const v = PainelService.variacao(p([100, 900, 120]), true, 30)!;
    expect(v.absoluto).toBe(20);
  });

  it('nao devolve variacao com um ponto so', () => {
    // Mostrar "0%" faria o cliente ler estabilidade onde nao houve medida.
    expect(PainelService.variacao(p([100]), true, 30)).toBeUndefined();
    expect(PainelService.variacao([], true, 30)).toBeUndefined();
  });

  it('nao devolve variacao em eixo de categoria', () => {
    // "Variacao" entre Cliente e Gestor nao significa nada.
    expect(PainelService.variacao(p([10, 20]), false, 30)).toBeUndefined();
  });

  it('omite o percentual quando a base e zero, mas mantem o absoluto', () => {
    // Dividir por zero daria Infinity, e "cresceu infinito" e pior que calar.
    const v = PainelService.variacao(p([0, 40]), true, 30)!;
    expect(v.percentual).toBeUndefined();
    expect(v.absoluto).toBe(40);
  });

  it('usa o modulo da base para o percentual nao inverter no negativo', () => {
    // De -100 para -50 o valor MELHOROU; com base sem modulo o sinal viraria.
    const v = PainelService.variacao(p([-100, -50]), true, 30)!;
    expect(v.absoluto).toBe(50);
    expect(v.percentual).toBeCloseTo(50);
  });

  it('carrega a janela para a tela poder nomear o periodo', () => {
    expect(PainelService.variacao(p([1, 2]), true, 7)!.dias).toBe(7);
  });
});
