import { abreviar, desenhar, porExtenso } from './grafico-svg';
import { DadosCard } from './painel.types';

function card(parcial: Partial<DadosCard>): DadosCard {
  return {
    id: 'c1',
    titulo: 'Vendas',
    tipo: 'barra',
    modulo: 'Planilhas',
    pontos: [],
    linhasLidas: 0,
    linhasIgnoradas: 0,
    eixoTemporal: false,
    ...parcial,
  };
}

describe('desenhar', () => {
  it('escapa o rotulo vindo da planilha', () => {
    // O rotulo e conteudo do CLIENTE e o SVG vai para innerHTML na pagina.
    // Sem escape, uma celula com markup viraria injecao no painel de quem
    // abrir — e quem digita na planilha nem precisa ser o dono da conta.
    const svg = desenhar(
      card({
        pontos: [
          { rotulo: '<script>alert(1)</script>', valor: 10 },
          { rotulo: 'Aspas " e & comercial', valor: 20 },
        ],
      }),
    );

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&amp;');
  });

  it('escapa tambem o titulo, que vai no aria-label', () => {
    const svg = desenhar(
      card({ titulo: 'Vendas "2026" <b>', pontos: [{ rotulo: 'jan', valor: 1 }] }),
    );

    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;');
  });

  it('sempre inclui o zero na escala', () => {
    // Comecar o eixo no menor valor faria uma variacao de 2% parecer um
    // desabamento — o grafico que mente sem ter nenhum numero errado.
    const svg = desenhar(
      card({
        pontos: [
          { rotulo: 'jan', valor: 1000 },
          { rotulo: 'fev', valor: 1020 },
        ],
      }),
    );

    // A marca do eixo Y mais baixa tem que ser 0, nao 1000.
    expect(svg).toContain('>0<');
  });

  it('gera rotulo acessivel com os valores', () => {
    const svg = desenhar(
      card({ titulo: 'Vendas', pontos: [{ rotulo: 'ago/2026', valor: 1500 }] }),
    );

    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Vendas. ago/2026: 1.500"');
  });

  it('desenha linha quando o tipo pede, e barra caso contrario', () => {
    const pontos = [
      { rotulo: 'jan', valor: 10 },
      { rotulo: 'fev', valor: 20 },
    ];

    expect(desenhar(card({ tipo: 'linha', pontos }))).toContain('class="linha"');
    expect(desenhar(card({ tipo: 'barra', pontos }))).toContain('class="barra"');
  });

  it('aguenta um ponto so sem gerar coordenada invalida', () => {
    // Com um ponto, o divisor (n-1) da linha viraria zero.
    const svg = desenhar(card({ tipo: 'linha', pontos: [{ rotulo: 'jan', valor: 5 }] }));

    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
  });

  it('aguenta todos os valores iguais a zero', () => {
    const svg = desenhar(
      card({
        pontos: [
          { rotulo: 'jan', valor: 0 },
          { rotulo: 'fev', valor: 0 },
        ],
      }),
    );

    expect(svg).not.toContain('NaN');
  });

  it('desenha valores negativos sem estourar a area', () => {
    const svg = desenhar(
      card({
        pontos: [
          { rotulo: 'jan', valor: -500 },
          { rotulo: 'fev', valor: 800 },
        ],
      }),
    );

    expect(svg).not.toContain('NaN');
    expect(svg).not.toMatch(/height="-/);
  });

  it('devolve vazio quando nao ha ponto nenhum', () => {
    expect(desenhar(card({ pontos: [] }))).toBe('');
  });
});

describe('abreviar', () => {
  it('encurta para caber no eixo', () => {
    expect(abreviar(980)).toBe('980');
    expect(abreviar(45000)).toBe('45 mil');
    expect(abreviar(1200000)).toBe('1,2 mi');
  });

  it('mantem a casa decimal quando o arredondamento contradiria o total', () => {
    // 1.096 virando "1 mil" faria o topo do eixo brigar com o total do card.
    expect(abreviar(1096)).toBe('1,1 mil');
  });

  it('usa virgula decimal', () => {
    expect(abreviar(1500000)).toContain(',');
  });

  it('funciona com negativo', () => {
    expect(abreviar(-45000)).toBe('-45 mil');
  });
});

describe('porExtenso', () => {
  it('formata em pt-BR', () => {
    expect(porExtenso(1500)).toBe('1.500');
    expect(porExtenso(1234.56)).toBe('1.234,56');
  });
});
