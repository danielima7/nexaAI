import Anthropic from '@anthropic-ai/sdk';

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
   * Executa a ferramenta com os argumentos que a IA forneceu.
   * @param input argumentos ja validados pelo schema
   * @param context contexto opcional (ex: contato que originou a acao)
   * @returns texto com o resultado (sera devolvido a IA)
   */
  execute(input: any, context?: ToolContext): Promise<string>;
}
