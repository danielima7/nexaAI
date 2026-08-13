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

/** Resultado de montar um card: dados prontos ou uma explicacao do porque nao. */
export interface DadosCard {
  id: string;
  titulo: string;
  tipo: TipoGrafico;
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
