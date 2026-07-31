import Anthropic from '@anthropic-ai/sdk';

/**
 * Quem esta do outro lado da conversa.
 *
 * - `owner`  — pessoa da propria organizacao (dono/equipe). Fala pelo WhatsApp
 *              corporativo ou pelo chat interno. Enxerga todas as ferramentas.
 * - `public` — pessoa de fora (ex: seguidor que mandou Direct no Instagram).
 *              E cliente DO cliente: nunca pode acessar dados internos como
 *              saldo bancario, CRM, planilhas ou e-mail da organizacao.
 */
export type ToolAudience = 'owner' | 'public';

/**
 * Contexto da execucao de uma ferramenta (quem originou a acao).
 * Usado para auditoria (OperationLog) e para ferramentas que precisam saber
 * o contato (ex: consultar o proprio historico).
 */
export interface ToolContext {
  /** Numero de WhatsApp (ou identificador) de quem originou a acao. */
  contact?: string;
  /** Organizacao (tenant) a que o contato pertence. */
  organizationId?: string;
  /** Usuario que originou a acao. */
  userId?: string;
  /**
   * Audiencia da conversa. Ausente = `owner`, porque todos os canais atuais
   * (WhatsApp corporativo e chat web) sao do proprio dono.
   */
  audience?: ToolAudience;

  /**
   * Instrucoes que o dono escreveu para o atendimento ao publico.
   * Usadas apenas quando `audience` e `public` — definem quem o assistente e
   * e o que ele pode dizer para quem chega pelo Direct.
   */
  instrucoesPublicas?: string | null;

  /**
   * Organizacao de DEMONSTRACAO: as ferramentas devolvem dados ficticios em vez
   * de chamar as APIs reais. Usado para apresentar o produto sem credenciais e
   * sem expor dados de ninguem.
   */
  demo?: boolean;
}

/**
 * Contrato de uma ferramenta (Tool) que a IA pode acionar.
 *
 * Cada integracao (HubSpot, Stripe...) fornece suas ferramentas implementando
 * esta interface e registrando-as no ToolRegistryService. Assim a IA ganha
 * novas capacidades sem que o AiService precise conhecer cada integracao.
 */
export interface AgentTool {
  /** Definicao no formato que a API do Claude espera (nome, descricao, schema). */
  definition: Anthropic.Tool;

  /**
   * Para quem esta ferramenta pode ser exposta.
   *
   * OMITIR SIGNIFICA `owner` (fail-closed) — de proposito: uma ferramenta nova
   * nasce privada, e so vira publica quando alguem decidir isso explicitamente.
   * O contrario faria uma integracao futura vazar dados internos por esquecimento.
   */
  audience?: ToolAudience;

  /**
   * A ferramenta CRIA ou ALTERA dados em um sistema do cliente?
   *
   * Marcando `true`, o registry exige uma confirmacao explicita antes de
   * executar: a primeira chamada nao roda nada e devolve uma instrucao para a
   * IA descrever a acao ao usuario e so entao chamar de novo com
   * `confirmado: true`.
   *
   * POR QUE: uma leitura errada gera uma resposta errada — chato, mas
   * reversivel. Uma ESCRITA errada cadastra a empresa errada no CRM do cliente
   * ou grava a linha errada na planilha de faturamento dele, e isso o cliente
   * descobre depois, quando o dado ja contaminou o relatorio.
   *
   * Consultas puras devem deixar em branco: pedir confirmacao para "qual meu
   * saldo?" so treina o usuario a dizer "sim" sem ler.
   */
  escrita?: boolean;

  /**
   * Executa a ferramenta com os argumentos que a IA forneceu.
   * @param input argumentos ja validados pelo schema
   * @param context contexto opcional (ex: contato que originou a acao)
   * @returns texto com o resultado (sera devolvido a IA)
   */
  execute(input: any, context?: ToolContext): Promise<string>;
}
