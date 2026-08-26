/**
 * Contrato entre a decisao da IA e o desenho do grafico.
 *
 * A IA preenche um `ConfigPlanilha` uma unica vez, quando o cliente pede o
 * grafico na conversa. Dali em diante o painel le este objeto e monta a serie
 * em codigo puro — sem IA, sem custo e sempre igual.
 */

/** Como desenhar o card. */
export type TipoGrafico = 'barra' | 'linha' | 'numero';

/** O que fazer com varias linhas que caem no mesmo rotulo. */
export type Agregacao = 'soma' | 'media' | 'contagem' | 'maximo' | 'minimo';

/** Granularidade quando o rotulo e uma data. */
export type Agrupamento = 'dia' | 'mes' | 'ano';

/** Mapeamento de um grafico que le uma planilha do Google. */
export interface ConfigPlanilha {
  /** ID da planilha (nunca a URL: o service ja normaliza na criacao). */
  planilhaId: string;
  /** Nome da aba. Vazio = primeira aba. */
  aba?: string;
  /**
   * Nome do cabecalho da coluna que vira rotulo (eixo X).
   *
   * Nome, e nao indice — ver o comentario do model PainelCard.
   */
  colunaRotulo: string;
  /** Nome do cabecalho da coluna numerica que vira valor (eixo Y). */
  colunaValor: string;
  /** Como consolidar linhas repetidas no mesmo rotulo. */
  agregacao: Agregacao;
  /** So quando a coluna de rotulo for data. */
  agruparPor?: Agrupamento;
  /**
   * Quantos pontos mostrar, do fim para o comeco.
   *
   * Existe porque grafico de 400 barras nao comunica nada: o cliente quer os
   * ultimos 12 meses, nao a planilha inteira redesenhada.
   */
  limitePontos?: number;
}

/** Um ponto pronto para desenhar. */
export interface Ponto {
  rotulo: string;
  valor: number;
  /** Chave de ordenacao (ISO, quando o rotulo veio de data). */
  ordem?: string;
}

/**
 * Variacao do primeiro ao ultimo ponto da janela.
 *
 * So existe em serie temporal com pelo menos DOIS pontos: com um ponto nao ha
 * variacao nenhuma, e inventar "0%" faria o cliente ler estabilidade onde na
 * verdade nao ha medida.
 */
export interface Variacao {
  /** Diferenca percentual. Ausente quando o valor inicial e zero. */
  percentual?: number;
  /** Diferenca absoluta — sempre calculavel. */
  absoluto: number;
  /** Quantos dias a janela cobre, para nomear o periodo ao cliente. */
  dias: number;
}

/** Resultado de montar um card: dados prontos ou uma explicacao do porque nao. */
export interface DadosCard {
  id: string;
  titulo: string;
  tipo: TipoGrafico;
  /** Secao do painel (Redes sociais, CRM, Planilhas...). */
  modulo: string;
  /**
   * A metrica ACUMULA ao longo do tempo, ou e uma fotografia de cada dia?
   *
   * A distincao decide o numero em destaque no card, e errar nela produz um
   * numero absurdo com cara de correto:
   *
   *  - FLUXO (`true`): alcance por dia, vendas por mes, interacoes. Cada ponto
   *    e uma quantidade nova, e somar o periodo faz sentido.
   *  - ESTOQUE (`false`): seguidores, saldo, valor do funil. Cada ponto e o
   *    estado naquele dia. Somar oito medicoes de mil seguidores devolve oito
   *    mil seguidores, que a empresa nunca teve.
   */
  acumulativo: boolean;
  /** Variacao no periodo, quando faz sentido calcular. */
  variacao?: Variacao;
  pontos: Ponto[];
  /**
   * Quantas linhas foram ignoradas por nao terem numero na coluna de valor.
   *
   * Exibido ao cliente de proposito: um grafico que descartou 300 de 500
   * linhas em silencio e um grafico mentiroso. Ele precisa saber para ir
   * arrumar a planilha.
   */
  linhasIgnoradas: number;
  /** Total de linhas de dado consideradas. */
  linhasLidas: number;
  /** Eixo X e linha do tempo (true) ou lista de categorias (false). */
  eixoTemporal: boolean;
  /**
   * Ressalva sobre o dado, quando o card FUNCIONA mas tem limitacao.
   *
   * Diferente de `erro`, que significa "nao deu". Aqui o grafico aparece, mas
   * o cliente precisa saber de algo — a serie comecou hoje, ou o CRM tem mais
   * negocios do que coube na leitura.
   */
  aviso?: string;
  /** Preenchido quando o card nao pode ser montado. */
  erro?: string;
}
