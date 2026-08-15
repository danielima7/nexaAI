import { LimitadorTaxaService, REGRAS } from './limitador-taxa.service';

describe('LimitadorTaxaService', () => {
  let limitador: LimitadorTaxaService;

  beforeEach(() => {
    limitador = new LimitadorTaxaService();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  const regra = { nome: 'teste', max: 3, janelaMs: 60_000 };

  it('libera ate o limite e bloqueia depois', () => {
    for (let i = 0; i < 3; i++) {
      expect(limitador.permitir('ip-1', regra)).toBe(true);
    }
    expect(limitador.permitir('ip-1', regra)).toBe(false);
  });

  it('conta cada origem separadamente', () => {
    // Um cliente abusando nao pode bloquear os outros.
    for (let i = 0; i < 4; i++) limitador.permitir('ip-1', regra);
    expect(limitador.permitir('ip-2', regra)).toBe(true);
  });

  it('nao mistura regras diferentes na mesma origem', () => {
    // Antes desta classe, tentar login gastava a cota de criar conta.
    const outra = { nome: 'outra', max: 1, janelaMs: 60_000 };
    for (let i = 0; i < 4; i++) limitador.permitir('ip-1', regra);
    expect(limitador.permitir('ip-1', outra)).toBe(true);
  });

  it('libera de novo quando a janela passa', () => {
    for (let i = 0; i < 4; i++) limitador.permitir('ip-1', regra);
    expect(limitador.permitir('ip-1', regra)).toBe(false);

    jest.advanceTimersByTime(60_001);
    expect(limitador.permitir('ip-1', regra)).toBe(true);
  });

  it('informa quanto falta para liberar', () => {
    limitador.permitir('ip-1', regra);
    expect(limitador.segundosParaLiberar('ip-1', regra)).toBeLessThanOrEqual(60);
    expect(limitador.segundosParaLiberar('ip-1', regra)).toBeGreaterThan(0);
    // Origem nunca vista nao tem espera.
    expect(limitador.segundosParaLiberar('ip-novo', regra)).toBe(0);
  });

  it('nao cresce sem limite com origens rotativas', () => {
    // Um Map indexado por IP cresceria para sempre; quem rotaciona endereco
    // derrubaria o processo por memoria.
    const janelaCurta = { nome: 'curta', max: 1, janelaMs: 1_000 };
    for (let i = 0; i < 25_000; i++) {
      limitador.permitir('ip-' + i, janelaCurta);
      if (i === 12_000) jest.advanceTimersByTime(2_000);
    }

    const tamanho = (limitador as unknown as { baldes: Map<string, unknown> })
      .baldes.size;
    expect(tamanho).toBeLessThanOrEqual(20_000);
  });

  it('as regras de producao tem os valores esperados', () => {
    // Travado por teste porque sao numeros de negocio: mexer neles muda o
    // custo que uma conta consegue gerar.
    expect(REGRAS.MENSAGEM.max).toBe(20);
    expect(REGRAS.MENSAGEM.janelaMs).toBe(60_000);
    expect(REGRAS.CADASTRO.max).toBe(3);
    expect(REGRAS.CADASTRO.janelaMs).toBe(3_600_000);
  });
});
