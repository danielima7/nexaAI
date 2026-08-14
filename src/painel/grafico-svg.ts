import { DadosCard, Ponto } from './painel.types';

/**
 * Desenha o grafico em SVG, sem biblioteca.
 *
 * Por que sem Chart.js e afins: uma CDN externa vira um terceiro no caminho
 * critico do produto (se ela cair, o painel do cliente quebra), complica o CSP
 * no deploy e adiciona ~200KB para desenhar barra e linha. O que precisamos
 * aqui e geometria simples, e SVG faz isso nativamente.
 *
 * Gerado no SERVIDOR de proposito: o dado ja vem pronto e o navegador so
 * pinta. Sem tela em branco esperando JavaScript, e funciona igual em celular
 * fraco — que e o aparelho de boa parte dos donos de PME.
 */

/** Escapa texto que vai para dentro do SVG (rotulo vem da planilha). */
function esc(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Numero curto para caber no eixo: 1,2 mi, 45 mil, 1,1 mil, 980.
 *
 * Uma casa decimal, e nao arredondamento cheio, porque 1.096 seguidores viram
 * "1 mil" no arredondamento — o topo do eixo passaria a contradizer o total
 * exibido no cabecalho do card. A casa decimal e descartada quando nao muda
 * nada (45,0 vira 45).
 */
export function abreviar(valor: number): string {
  const curto = (n: number) =>
    n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

  const abs = Math.abs(valor);
  if (abs >= 1_000_000) return `${curto(valor / 1_000_000)} mi`;
  if (abs >= 1_000) return `${curto(valor / 1_000)} mil`;
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** Numero por extenso, para o rotulo acessivel e o card de total. */
export function porExtenso(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

const LARGURA = 640;
const ALTURA = 240;
const MARGEM = { topo: 18, direita: 12, baixo: 34, esquerda: 54 };

/** Area util do desenho, descontadas as margens dos eixos. */
const AREA = {
  largura: LARGURA - MARGEM.esquerda - MARGEM.direita,
  altura: ALTURA - MARGEM.topo - MARGEM.baixo,
};

/**
 * Escala vertical.
 *
 * O zero SEMPRE entra no dominio. Comecar o eixo no menor valor faria uma
 * variacao de 2% parecer um desabamento — o classico grafico que mente sem
 * nenhum numero errado nele.
 */
function escala(pontos: Ponto[]): { min: number; max: number } {
  const valores = pontos.map((p) => p.valor);
  const max = Math.max(0, ...valores);
  const min = Math.min(0, ...valores);
  // Tudo zero: evita divisao por zero e desenha a linha de base.
  if (max === min) return { min: 0, max: 1 };
  return { min, max };
}

/** Quantos rotulos cabem no eixo X sem virar borrao. */
function passoDeRotulo(quantidade: number): number {
  return Math.max(1, Math.ceil(quantidade / 12));
}

/**
 * Caminho de uma barra com a PONTA arredondada e a base reta.
 *
 * Um `rect rx` arredondaria os quatro cantos, inclusive onde a barra encosta na
 * linha de base — e barra que nao encosta na base sugere que ela flutua, ou
 * que o valor comeca acima do zero. O arredondamento e so na ponta do dado.
 */
function barraPath(
  x: number,
  largura: number,
  yPonta: number,
  yBase: number,
): string {
  const r = Math.min(4, largura / 2, Math.abs(yBase - yPonta));
  const f = (n: number) => n.toFixed(1);
  const paraCima = yPonta <= yBase;
  const s = paraCima ? 1 : -1; // sentido do arredondamento

  return (
    `M${f(x)},${f(yBase)} ` +
    `L${f(x)},${f(yPonta + r * s)} ` +
    `Q${f(x)},${f(yPonta)} ${f(x + r)},${f(yPonta)} ` +
    `L${f(x + largura - r)},${f(yPonta)} ` +
    `Q${f(x + largura)},${f(yPonta)} ${f(x + largura)},${f(yPonta + r * s)} ` +
    `L${f(x + largura)},${f(yBase)} Z`
  );
}

/** Grafico de barras — para categorias. */
function barras(pontos: Ponto[]): string {
  const { min, max } = escala(pontos);
  const amplitude = max - min;
  const larguraFaixa = AREA.largura / pontos.length;
  // Teto de 24px: barra grossa vira bloco de tinta e come o ar da faixa. O
  // -2 garante o vao de 2px na cor da superficie entre barras vizinhas, que e
  // o que as separa sem precisar desenhar contorno.
  const larguraBarra = Math.max(
    2,
    Math.min(24, larguraFaixa * 0.62, larguraFaixa - 2),
  );
  const y0 = MARGEM.topo + AREA.altura - ((0 - min) / amplitude) * AREA.altura;
  const passo = passoDeRotulo(pontos.length);

  const partes = pontos.map((p, i) => {
    const centro = MARGEM.esquerda + larguraFaixa * (i + 0.5);
    const y = MARGEM.topo + AREA.altura - ((p.valor - min) / amplitude) * AREA.altura;
    const x = centro - larguraBarra / 2;

    const rotulo =
      i % passo === 0
        ? `<text class="eixo" x="${centro}" y="${ALTURA - 12}" text-anchor="middle">${esc(p.rotulo)}</text>`
        : '';

    return (
      `<path class="barra" d="${barraPath(x, larguraBarra, y, y0)}">` +
      `<title>${esc(p.rotulo)}: ${porExtenso(p.valor)}</title></path>${rotulo}`
    );
  });

  return partes.join('') + linhaBase(y0);
}

/** Grafico de linha — para evolucao no tempo. */
function linha(pontos: Ponto[]): string {
  const { min, max } = escala(pontos);
  const amplitude = max - min;
  // Com um ponto so nao ha reta: o divisor viraria zero.
  const passoX = pontos.length > 1 ? AREA.largura / (pontos.length - 1) : 0;
  const y0 = MARGEM.topo + AREA.altura - ((0 - min) / amplitude) * AREA.altura;
  const passo = passoDeRotulo(pontos.length);

  const coords = pontos.map((p, i) => ({
    x: MARGEM.esquerda + (pontos.length > 1 ? passoX * i : AREA.largura / 2),
    y: MARGEM.topo + AREA.altura - ((p.valor - min) / amplitude) * AREA.altura,
    p,
  }));

  const caminho = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');

  const area =
    `M${coords[0].x.toFixed(1)},${y0.toFixed(1)} ` +
    coords.map((c) => `L${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ') +
    ` L${coords[coords.length - 1].x.toFixed(1)},${y0.toFixed(1)} Z`;

  // Marcador com raio 4 (8px de diametro) e anel de 2px na cor da superficie:
  // sem o anel, dois pontos proximos ou um ponto sobre a linha viram uma
  // mancha unica. O anel tambem engorda a area de toque no celular.
  const marcas = coords
    .map(
      (c) =>
        `<circle class="ponto" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4">` +
        `<title>${esc(c.p.rotulo)}: ${porExtenso(c.p.valor)}</title></circle>`,
    )
    .join('');

  const rotulos = coords
    .map((c, i) =>
      i % passo === 0
        ? `<text class="eixo" x="${c.x.toFixed(1)}" y="${ALTURA - 12}" text-anchor="middle">${esc(c.p.rotulo)}</text>`
        : '',
    )
    .join('');

  return (
    `<path class="area" d="${area}"/><path class="linha" d="${caminho}"/>` +
    marcas +
    rotulos +
    linhaBase(y0)
  );
}

/** Eixo horizontal no zero. */
function linhaBase(y0: number): string {
  return (
    `<line class="base" x1="${MARGEM.esquerda}" y1="${y0.toFixed(1)}" ` +
    `x2="${LARGURA - MARGEM.direita}" y2="${y0.toFixed(1)}"/>`
  );
}

/** Marcas do eixo Y: minimo, meio e maximo. Mais que isso vira poluicao. */
function eixoY(pontos: Ponto[]): string {
  const { min, max } = escala(pontos);
  const valores = [max, (max + min) / 2, min].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  return valores
    .map((v) => {
      const y =
        MARGEM.topo + AREA.altura - ((v - min) / (max - min || 1)) * AREA.altura;
      return (
        `<line class="grade" x1="${MARGEM.esquerda}" y1="${y.toFixed(1)}" x2="${LARGURA - MARGEM.direita}" y2="${y.toFixed(1)}"/>` +
        `<text class="eixo" x="${MARGEM.esquerda - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(abreviar(v))}</text>`
      );
    })
    .join('');
}

/**
 * SVG completo de um card.
 *
 * O `<title>` e o `role="img"` com `aria-label` nao sao enfeite: sem eles o
 * grafico e invisivel para leitor de tela, e a pagina de acessibilidade que
 * publicamos promete o contrario.
 */
export function desenhar(card: DadosCard): string {
  const pontos = card.pontos;
  if (pontos.length === 0) return '';

  const resumo = pontos
    .slice(-6)
    .map((p) => `${p.rotulo}: ${porExtenso(p.valor)}`)
    .join('; ');

  const corpo = card.tipo === 'linha' ? linha(pontos) : barras(pontos);

  return (
    `<svg viewBox="0 0 ${LARGURA} ${ALTURA}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="${esc(card.titulo)}. ${esc(resumo)}">` +
    eixoY(pontos) +
    corpo +
    '</svg>'
  );
}
