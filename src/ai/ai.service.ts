import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage } from './conversation-memory.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolContext } from '../tools/tool.interface';

/**
 * Service de IA do Kyrius (Claude / Anthropic).
 *
 * Recebe o historico da conversa e devolve uma resposta inteligente com
 * contexto. Quando ha ferramentas (Tools) registradas, a IA pode decidir
 * aciona-las (ex: criar empresa no HubSpot) — este service roda o loop
 * de tool use ate a IA ter tudo o que precisa para responder.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  /**
   * Prompt de sistema: define a persona e o comportamento do Kyrius.
   * Mantido conciso de proposito (respostas por WhatsApp devem ser curtas).
   */
  private readonly systemPrompt = [
    'Voce e o Kyrius, um assistente de IA corporativo que atende empresas pelo WhatsApp.',
    'Responda em portugues do Brasil, de forma clara, cordial e objetiva.',
    'Voce tem memoria da conversa: as mensagens anteriores deste contato estao no',
    'historico. Use esse contexto naturalmente e lembre do que foi dito. Nao diga',
    'que nao consegue lembrar ou salvar informacoes da conversa.',
    'Como as respostas sao lidas no WhatsApp, seja breve: evite textos longos,',
    'use frases curtas e, quando fizer sentido, listas simples.',
    'Voce pode ter ferramentas conectadas (ex: HubSpot). Use-as quando o',
    'usuario pedir uma acao ou consulta que elas atendam. Nunca invente dados:',
    'se nao houver ferramenta para o que foi pedido, diga com clareza que essa',
    'integracao ainda nao esta disponivel.',
    'Antes de criar ou alterar qualquer dado (cadastrar, atualizar, enviar,',
    'adicionar linha em planilha), diga em uma frase o que sera feito e com',
    'quais valores, e espere o usuario confirmar. Consultas nao precisam de',
    'confirmacao — pergunte apenas quando a acao mudar algo.',
    'Nunca peca chaves de API, tokens ou senhas pela conversa: oriente o usuario',
    'a usar a pagina de integracoes.',
  ].join(' ');

  /**
   * Prompt do atendimento AO PUBLICO (ex: Direct do Instagram).
   *
   * Quem fala aqui NAO e o dono da empresa — e um cliente dele. Por isso o
   * assistente muda de papel: deixa de ser o analista interno e vira o
   * atendimento da loja. As instrucoes especificas de cada empresa entram
   * depois deste bloco, escritas pelo proprio dono.
   */
  private readonly systemPromptPublico = [
    'Voce e o atendimento virtual de uma empresa, conversando com um cliente ou',
    'interessado que entrou em contato. Responda em portugues do Brasil, de forma',
    'cordial, curta e direta.',
    'Responda SOMENTE com base nas informacoes fornecidas abaixo pelo dono da',
    'empresa. Se a pergunta nao estiver coberta por elas, diga que vai verificar',
    'e que alguem da equipe retorna — nunca invente horario, preco, prazo,',
    'endereco ou disponibilidade.',
    'Voce nao tem acesso a dados internos, financeiros ou de outros clientes, e',
    'nao deve prometer nada em nome da empresa.',
    'Se pedirem dados pessoais, pagamento ou algo sensivel, oriente a pessoa a',
    'falar diretamente com a equipe.',
  ].join(' ');

  /** Limite de rodadas de tool use por mensagem (evita loop infinito). */
  private readonly MAX_TOOL_ROUNDS = 5;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: ToolRegistryService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.model =
      this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-4-8';
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Monta o prompt de sistema conforme quem esta do outro lado.
   *
   * `owner` (WhatsApp corporativo, chat web) recebe o assistente completo.
   * `public` (Direct do Instagram) recebe o atendimento, restrito as
   * instrucoes que o dono escreveu — sem elas, nao ha o que responder e o
   * proprio prompt orienta a encaminhar para a equipe.
   */
  private montarSystem(context?: ToolContext): string {
    if (context?.audience !== 'public') return this.systemPrompt;

    const instrucoes = context.instrucoesPublicas?.trim();
    return instrucoes
      ? `${this.systemPromptPublico}\n\nInformacoes da empresa (fornecidas pelo dono):\n${instrucoes}`
      : this.systemPromptPublico;
  }

  /**
   * Gera uma resposta da IA considerando todo o historico da conversa.
   * @param history mensagens anteriores + a mensagem atual (ultima da lista)
   * @returns resposta em texto para enviar de volta
   */
  async generateReply(
    history: ChatMessage[],
    context?: ToolContext,
  ): Promise<string> {
    try {
      // Copia local das mensagens (o loop de tools vai crescendo esta lista).
      const messages: Anthropic.MessageParam[] = history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Ferramentas disponiveis para esta audiencia (vazio = chat puro).
      // Conversa com publico externo so enxerga ferramentas marcadas como
      // `public`; o padrao (`owner`) mantem os canais atuais inalterados.
      const toolDefs = this.tools.getDefinitions(context?.audience);

      // O papel do assistente muda conforme quem esta do outro lado.
      const system = this.montarSystem(context);

      // Loop de tool use: repete enquanto a IA pedir para usar ferramentas.
      for (let round = 0; round < this.MAX_TOOL_ROUNDS; round++) {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          // Prompt caching: o marcador no ultimo bloco de system faz a API
          // cachear TUDO que vem antes (ferramentas + system). Nas chamadas
          // seguintes, esse prefixo custa ~10% — grande reducao de custo.
          system: [
            {
              type: 'text',
              text: system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
        });

        // Log de cache (verificar economia): read = tokens servidos do cache.
        const u = response.usage;
        this.logger.debug(
          `tokens: input=${u.input_tokens} cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} output=${u.output_tokens}`,
        );

        // A IA quer usar uma ou mais ferramentas.
        if (response.stop_reason === 'tool_use') {
          // Guarda o turno do assistente (contem os blocos tool_use).
          messages.push({ role: 'assistant', content: response.content });

          // Executa cada ferramenta pedida e monta os resultados.
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type === 'tool_use') {
              const result = await this.tools.execute(
                block.name,
                block.input,
                context,
              );
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result,
              });
            }
          }

          // Devolve os resultados para a IA e roda outra rodada.
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        // Sem tool use: resposta final. Concatena os blocos de texto.
        const text = response.content
          .filter(
            (block): block is Anthropic.TextBlock => block.type === 'text',
          )
          .map((block) => block.text)
          .join('')
          .trim();

        return text || 'Desculpe, nao consegui gerar uma resposta agora.';
      }

      // Estourou o limite de rodadas de ferramentas.
      this.logger.warn('Limite de rodadas de tool use atingido.');
      return 'Precisei de muitos passos para concluir isso e parei por seguranca. Pode reformular o pedido?';
    } catch (error: any) {
      const details = error?.message ?? error;
      this.logger.error(`Falha ao chamar a IA: ${JSON.stringify(details)}`);
      // Em caso de erro, devolvemos uma mensagem amigavel (nao vazamos o erro).
      return 'Tive um problema para processar sua mensagem agora. Pode tentar de novo em instantes?';
    }
  }
}
