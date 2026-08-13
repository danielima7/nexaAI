/**
 * Leitura de celulas de planilha para valores tipados.
 *
 * Por que existe um arquivo so para isto: o Google Sheets devolve `string[][]`
 * — texto cru, do jeito que o dono da PME digitou. "R$ 1.234,56", "05/08/2026",
 * "12%", "(300,00)" para negativo, celula vazia no meio da coluna. Um grafico
 * montado em cima disso sem tratamento nao quebra: ele mostra um numero
 * ERRADO, com aparencia de certo, e o cliente decide em cima dele. Esse e o
 * pior defeito possivel nesta feature.
 *
 * Tudo aqui e funcao pura, sem I/O, para poder ser coberto por teste de mesa
 * com os formatos reais que aparecem em planilha brasileira.
 */

/** Uma coluna ja classificada pelo conteudo que ela carrega. */
export type TipoColuna = 'numero' | 'data' | 'texto';

/** Cabecalho localizado dentro da matriz crua. */
export interface Cabecalho {
  /** Indice da linha do cabecalho na matriz original. */
  linha: number;
  /** Nomes das colunas, ja limpos. */
  colunas: string[];
}

/** Caracteres que separam milhar/decimal, alem de simbolos de moeda. */
const LIXO_NUMERICO = /[R$\s  ]/gi;

/**
 * Converte uma celula em numero, ou `null` quando ela nao e numerica.
 *
 * Devolve `null` em vez de 0 de proposito: celula vazia e "venda de zero" sao
 * fatos diferentes, e somar vazio como zero distorce media e minimo. Quem
 * agrega decide o que fazer com a ausencia.
 *
 * REGRA DO SEPARADOR — a parte que mais erra na pratica:
 *  - Com ponto E virgula, o ULTIMO que aparece e o decimal. Cobre tanto
 *    "1.234,56" (BR) quanto "1,234.56" (US, comum quando a planilha veio
 *    exportada de sistema gringo).
 *  - So virgula: e decimal. "1,5" no Brasil e um e meio.
 *  - So ponto, com exatamente 3 digitos depois e nada antes de 4 digitos:
 *    tratado como MILHAR. "1.500" numa planilha brasileira e mil e quinhentos,
 *    nao um e meio. Essa e a unica decisao ambigua do arquivo, e ela erra a
 *    favor do caso comum — documentada aqui porque um dia alguem vai
 *    questionar por que "1.500" virou 1500.
 */
export function interpretarNumero(bruto: unknown): number | null {
  if (typeof bruto === 'number') {
    return Number.isFinite(bruto) ? bruto : null;
  }
  if (bruto === null || bruto === undefined) return null;

  let texto = String(bruto).trim();
  if (texto === '') return null;

  // Percentual precisa ser detectado ANTES de remover simbolos.
  const percentual = texto.includes('%');

  // A limpeza vem ANTES da checagem de parenteses: "R$ (1.000,00)" tem moeda
  // do lado de fora, e testar o parentese primeiro nao casaria com nada.
  texto = texto.replace(LIXO_NUMERICO, '').replace(/%/g, '');
  if (texto === '') return null;

  // Contabilidade escreve negativo entre parenteses: (300,00) = -300.
  let negativo = false;
  if (/^\(.*\)$/.test(texto)) {
    negativo = true;
    texto = texto.slice(1, -1);
  }

  if (texto.startsWith('-')) {
    negativo = true;
    texto = texto.slice(1);
  } else if (texto.startsWith('+')) {
    texto = texto.slice(1);
  }

  // A partir daqui so pode restar digito, ponto e virgula.
  if (!/^[\d.,]+$/.test(texto)) return null;

  const temPonto = texto.includes('.');
  const temVirgula = texto.includes(',');

  let normalizado: string;
  if (temPonto && temVirgula) {
    const decimal = texto.lastIndexOf('.') > texto.lastIndexOf(',') ? '.' : ',';
    const milhar = decimal === '.' ? ',' : '.';
    normalizado = texto.split(milhar).join('').replace(decimal, '.');
  } else if (temVirgula) {
    // Virgula sozinha e sempre decimal no Brasil.
    normalizado = texto.replace(/,/g, '.');
  } else if (temPonto) {
    const partes = texto.split('.');
    const ultima = partes[partes.length - 1];
    // "1.234" ou "1.234.567": milhar. "1.5" ou "1.23": decimal.
    normalizado =
      partes.length > 2 || (partes.length === 2 && ultima.length === 3)
        ? partes.join('')
        : texto;
  } else {
    normalizado = texto;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return null;

  const comSinal = negativo ? -numero : numero;
  // 12% vira 0.12: quem plota decide se multiplica por 100 na exibicao.
  return percentual ? comSinal / 100 : comSinal;
}

/**
 * Converte uma celula em data, ou `null` quando ela nao e data.
 *
 * Aceita dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa e o ISO aaaa-mm-dd. NUNCA
 * interpreta como mm/dd: "05/08/2026" numa planilha brasileira e 5 de agosto,
 * e ler como 8 de maio jogaria a venda para outro mes no grafico — erro
 * silencioso e caro.
 *
 * O ano com 2 digitos vira 20xx: planilha de PME nao tem lancamento de 1998.
 *
 * A data e construida em UTC de proposito. Ela serve para AGRUPAR (por mes,
 * por dia), nao para marcar um instante; com fuso local, 01/08 no Brasil
 * viraria 31/07 em UTC e a venda mudaria de mes.
 */
export function interpretarData(bruto: unknown): Date | null {
  if (bruto instanceof Date) {
    return Number.isNaN(bruto.getTime()) ? null : bruto;
  }
  if (bruto === null || bruto === undefined) return null;

  const texto = String(bruto).trim();
  if (texto === '') return null;

  let ano: number;
  let mes: number;
  let dia: number;

  const iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  const br = texto.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);

  if (iso) {
    ano = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else if (br) {
    dia = Number(br[1]);
    mes = Number(br[2]);
    ano = Number(br[3]);
    if (ano < 100) ano += 2000;
  } else {
    return null;
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const data = new Date(Date.UTC(ano, mes - 1, dia));
  // Rejeita 31/02: o Date "corrige" para 03/03 em silencio, e uma data que
  // nao existe na planilha nao pode virar um ponto valido no grafico.
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }

  return data;
}

/** A celula esta vazia (nao preenchida, so espaco)? */
export function celulaVazia(bruto: unknown): boolean {
  return bruto === null || bruto === undefined || String(bruto).trim() === '';
}

/**
 * Localiza a linha de cabecalho numa matriz crua.
 *
 * Planilha de PME quase nunca comeca em A1: tem titulo em letra grande, linha
 * em branco, as vezes um logo. Assumir "linha 0 = cabecalho" faria o primeiro
 * grafico nascer com as colunas chamadas "Relatorio de Vendas" e "".
 *
 * Criterio: a primeira linha com pelo menos duas celulas preenchidas em que
 * NENHUMA seja numero. Cabecalho e composto de rotulos; linha de dado tem
 * numero. Simples e previsivel — e quando erra, erra de um jeito que o cliente
 * ve na hora (nomes de coluna estranhos), nao de um jeito que falsifica valor.
 */
export function detectarCabecalho(linhas: unknown[][]): Cabecalho | null {
  const limite = Math.min(linhas.length, 15); // titulo longo nao passa disso

  for (let i = 0; i < limite; i++) {
    const linha = linhas[i] ?? [];
    const preenchidas = linha.filter((c) => !celulaVazia(c));
    if (preenchidas.length < 2) continue;
    if (preenchidas.some((c) => interpretarNumero(c) !== null)) continue;

    return {
      linha: i,
      colunas: linha.map((c, idx) =>
        celulaVazia(c) ? `Coluna ${idx + 1}` : String(c).trim(),
      ),
    };
  }

  return null;
}

/**
 * Classifica uma coluna pelo conteudo das celulas, ignorando vazias.
 *
 * Maioria simples: uma coluna de datas com um "a definir" no meio continua
 * sendo coluna de data. Exigir unanimidade faria uma unica celula digitada
 * errado desqualificar a coluna inteira.
 *
 * Numero e testado ANTES de data porque "2026" passa nos dois — e num
 * grafico de vendas essa coluna e um valor, nao um dia.
 */
export function classificarColuna(celulas: unknown[]): TipoColuna {
  let numeros = 0;
  let datas = 0;
  let preenchidas = 0;

  for (const c of celulas) {
    if (celulaVazia(c)) continue;
    preenchidas++;
    if (interpretarNumero(c) !== null) numeros++;
    else if (interpretarData(c) !== null) datas++;
  }

  if (preenchidas === 0) return 'texto';
  if (numeros / preenchidas > 0.5) return 'numero';
  if (datas / preenchidas > 0.5) return 'data';
  return 'texto';
}
