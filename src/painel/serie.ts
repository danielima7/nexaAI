import {
  celulaVazia,
  classificarColuna,
  detectarCabecalho,
  interpretarData,
  interpretarNumero,
} from './planilha-parser';
import { Agregacao, ConfigPlanilha, Ponto } from './painel.types';

/** Resultado de montar a serie a partir da matriz crua. */
export interface Serie {
  pontos: Ponto[];
  linhasLidas: number;
  linhasIgnoradas: number;
  /**
   * O eixo X e uma linha do tempo ou uma lista de categorias?
   *
   * Sai daqui porque quem descobre isso e a classificacao da coluna, nao a
   * tela. Sem esta informacao a pagina chamaria "Cliente, Gestor, Operador"
   * de "periodos" — texto errado na frente do cliente.
   */
  eixoTemporal: boolean;
}

/** Erro com mensagem que o CLIENTE le — nao detalhe tecnico. */
export class SerieError extends Error {}

/**
 * Transforma a matriz crua da planilha na serie que o grafico desenha.
 *
 * Funcao pura: recebe celulas e configuracao, devolve pontos. Nada de rede,
 * nada de banco. E aqui que mora a regra de negocio do painel, entao ela
 * precisa ser testavel sem Google nenhum.
 */
export function montarSerie(
  valores: unknown[][],
  config: ConfigPlanilha,
): Serie {
  const cabecalho = detectarCabecalho(valores);
  if (!cabecalho) {
    throw new SerieError(
      'Não consegui identificar a linha de cabeçalho da planilha. ' +
        'Confira se a primeira linha preenchida tem os nomes das colunas.',
    );
  }

  const iRotulo = indiceDaColuna(cabecalho.colunas, config.colunaRotulo);
  const iValor = indiceDaColuna(cabecalho.colunas, config.colunaValor);

  // Coluna que sumiu vira erro visivel, e nao um grafico vazio: o cliente
  // renomeou ou apagou a coluna, e precisa saber disso para arrumar.
  if (iRotulo < 0) {
    throw new SerieError(
      `A coluna "${config.colunaRotulo}" não existe mais na planilha. ` +
        `Colunas encontradas: ${cabecalho.colunas.join(', ')}.`,
    );
  }
  if (iValor < 0) {
    throw new SerieError(
      `A coluna "${config.colunaValor}" não existe mais na planilha. ` +
        `Colunas encontradas: ${cabecalho.colunas.join(', ')}.`,
    );
  }

  const dados = valores.slice(cabecalho.linha + 1);

  // O tipo do rotulo decide se agrupamos por periodo ou por categoria.
  const rotuloEhData =
    classificarColuna(dados.map((l) => l?.[iRotulo])) === 'data';

  // Map preserva a ordem de insercao — importante para categoria, onde a
  // ordem natural e a que aparece na planilha, nao a alfabetica.
  const grupos = new Map<string, { ordem: string; valores: number[] }>();
  let linhasLidas = 0;
  let linhasIgnoradas = 0;

  for (const linha of dados) {
    const bruta = linha ?? [];
    // Linha totalmente vazia e separador visual, nao dado faltando.
    if (bruta.every((c) => celulaVazia(c))) continue;

    linhasLidas++;

    const valor = interpretarNumero(bruta[iValor]);
    if (valor === null) {
      linhasIgnoradas++;
      continue;
    }

    const chave = rotuloEhData
      ? chaveDeData(bruta[iRotulo], config.agruparPor ?? 'mes')
      : chaveDeTexto(bruta[iRotulo]);

    if (!chave) {
      linhasIgnoradas++;
      continue;
    }

    const atual = grupos.get(chave.rotulo);
    if (atual) atual.valores.push(valor);
    else grupos.set(chave.rotulo, { ordem: chave.ordem, valores: [valor] });
  }

  let pontos: Ponto[] = [...grupos.entries()].map(([rotulo, g]) => ({
    rotulo,
    valor: aplicar(config.agregacao, g.valores),
    ordem: g.ordem,
  }));

  // Data ordena cronologicamente; categoria mantem a ordem da planilha.
  if (rotuloEhData) {
    pontos.sort((a, b) => (a.ordem ?? '').localeCompare(b.ordem ?? ''));
  }

  // Corta pelo FIM: quem pede "ultimos 12 meses" quer os mais recentes.
  const limite = config.limitePontos;
  if (limite && limite > 0 && pontos.length > limite) {
    pontos = pontos.slice(-limite);
  }

  return { pontos, linhasLidas, linhasIgnoradas, eixoTemporal: rotuloEhData };
}

/**
 * Casa o nome guardado com o cabecalho atual, tolerando diferenca de caixa,
 * acento e espaco.
 *
 * O cliente troca "Valor" por "valor " sem considerar isso uma mudanca — e do
 * ponto de vista dele nao e. Exigir igualdade exata quebraria o painel por um
 * detalhe invisivel.
 */
function indiceDaColuna(colunas: string[], procurada: string): number {
  const alvo = normalizar(procurada);
  return colunas.findIndex((c) => normalizar(c) === alvo);
}

/** Minusculas, sem acento, sem espaco duplicado. */
function normalizar(texto: string): string {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const MESES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/**
 * Rotulo e chave de ordenacao de uma celula de data.
 *
 * O rotulo e para humano ler ("ago/2026"); a `ordem` e ISO, para ordenar. Sao
 * separados porque ordenar "ago/2026" como texto colocaria abril antes de
 * janeiro.
 */
function chaveDeData(
  bruto: unknown,
  granularidade: 'dia' | 'mes' | 'ano',
): { rotulo: string; ordem: string } | null {
  const data = interpretarData(bruto);
  if (!data) return null;

  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth();
  const dia = data.getUTCDate();
  const p2 = (n: number) => String(n).padStart(2, '0');

  if (granularidade === 'ano') {
    return { rotulo: String(ano), ordem: String(ano) };
  }
  if (granularidade === 'dia') {
    return {
      rotulo: `${p2(dia)}/${p2(mes + 1)}`,
      ordem: `${ano}-${p2(mes + 1)}-${p2(dia)}`,
    };
  }
  return {
    rotulo: `${MESES[mes]}/${ano}`,
    ordem: `${ano}-${p2(mes + 1)}`,
  };
}

/** Rotulo de uma celula de texto (categoria). */
function chaveDeTexto(bruto: unknown): { rotulo: string; ordem: string } | null {
  if (celulaVazia(bruto)) return null;
  const rotulo = String(bruto).trim();
  return { rotulo, ordem: rotulo };
}

/** Consolida os valores que cairam no mesmo rotulo. */
function aplicar(agregacao: Agregacao, valores: number[]): number {
  switch (agregacao) {
    case 'contagem':
      return valores.length;
    case 'media':
      return valores.reduce((a, b) => a + b, 0) / valores.length;
    case 'maximo':
      return Math.max(...valores);
    case 'minimo':
      return Math.min(...valores);
    case 'soma':
    default:
      return valores.reduce((a, b) => a + b, 0);
  }
}
