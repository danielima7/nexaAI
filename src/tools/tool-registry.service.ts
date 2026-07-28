import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AgentTool, ToolAudience, ToolContext } from './tool.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Registro central de ferramentas (Tools) disponiveis para a IA.
 *
 * Alem de despachar a execucao, GRAVA cada operacao no banco (OperationLog)
 * para fins de auditoria / historico de operacoes.
 */
@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, AgentTool>();

  constructor(private readonly prisma: PrismaService) {}

  /** Registra uma ferramenta. Chamado por cada integracao na inicializacao. */
  register(tool: AgentTool): void {
    this.tools.set(tool.definition.name, tool);
    this.logger.log(
      `Tool registrada: ${tool.definition.name} [${this.audienceOf(tool)}]`,
    );
  }

  /** Ha alguma ferramenta registrada? */
  hasTools(): boolean {
    return this.tools.size > 0;
  }

  /** Audiencia efetiva da ferramenta (omitida = `owner`, fail-closed). */
  private audienceOf(tool: AgentTool): ToolAudience {
    return tool.audience ?? 'owner';
  }

  /**
   * A ferramenta pode ser usada por esta audiencia?
   *
   * O dono enxerga tudo. Uma audiencia publica so alcanca ferramentas
   * marcadas explicitamente como `public`.
   */
  private permite(tool: AgentTool, audience: ToolAudience): boolean {
    return audience === 'owner' || this.audienceOf(tool) === 'public';
  }

  /**
   * Lista as definicoes para enviar ao Claude, filtradas pela audiencia.
   *
   * O padrao e `owner` para nao alterar o comportamento dos canais atuais
   * (WhatsApp e chat web, ambos do proprio dono).
   */
  getDefinitions(audience: ToolAudience = 'owner'): Anthropic.Tool[] {
    return [...this.tools.values()]
      .filter((t) => this.permite(t, audience))
      .map((t) => t.definition);
  }

  /**
   * Executa uma ferramenta pelo nome e registra a operacao no banco.
   * Nunca lanca excecao: em caso de erro, devolve mensagem de texto para a IA.
   */
  async execute(name: string, input: any, context?: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Ferramenta "${name}" nao encontrada.`;
    }

    // Segunda barreira de audiencia. Filtrar `getDefinitions` esconde a
    // ferramenta do modelo, mas nao impede que ela seja chamada pelo nome —
    // por alucinacao ou por injecao de prompt vinda de uma mensagem externa.
    // A decisao de autorizacao tem que morar aqui, junto da execucao.
    const audience = context?.audience ?? 'owner';
    if (!this.permite(tool, audience)) {
      this.logger.warn(
        `Tool ${name} negada para audiencia "${audience}" (contato ${context?.contact ?? '—'}).`,
      );
      const recusa = `Ferramenta "${name}" nao esta disponivel nesta conversa.`;
      // Tentativa negada tambem e auditada: e sinal de abuso ou de injecao.
      await this.logOperation(name, input, recusa, false, context);
      return recusa;
    }

    let result: string;
    let success = true;
    try {
      this.logger.log(`Executando tool ${name} com input: ${JSON.stringify(input)}`);
      result = await tool.execute(input, context);
    } catch (error: any) {
      success = false;
      const details = error?.response?.data ?? error?.message ?? error;
      this.logger.error(`Erro na tool ${name}: ${JSON.stringify(details)}`);
      result = `Erro ao executar ${name}: ${JSON.stringify(details)}`;
    }

    // Auditoria: grava a operacao (best-effort, nao quebra o fluxo se falhar).
    await this.logOperation(name, input, result, success, context);
    return result;
  }

  /** Grava a operacao no OperationLog. */
  private async logOperation(
    tool: string,
    input: any,
    result: string,
    success: boolean,
    context?: ToolContext,
  ): Promise<void> {
    try {
      await this.prisma.operationLog.create({
        data: {
          contact: context?.contact ?? '',
          tool,
          input: input ?? {},
          result: result.slice(0, 2000),
          success,
          organizationId: context?.organizationId,
          userId: context?.userId,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Falha ao registrar OperationLog: ${e?.message ?? e}`);
    }
  }
}
