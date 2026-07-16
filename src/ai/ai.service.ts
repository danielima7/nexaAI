import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Service de IA do Nexa (Claude / Anthropic).
 *
 * Responsabilidade nesta fase: receber a mensagem do usuario em linguagem
 * natural e devolver uma resposta inteligente. Ainda SEM ferramentas (Tools).
 *
 * Proxima fase: adicionar Tools para a IA consultar/executar acoes nas
 * integracoes (HubSpot, bancos, etc.), como descrito no CLAUDE.md.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  /**
   * Prompt de sistema: define a persona e o comportamento do Nexa.
   * Mantido conciso de proposito (respostas por WhatsApp devem ser curtas).
   */
  private readonly systemPrompt = [
    'Voce e o Nexa, um assistente de IA corporativo que atende empresas pelo WhatsApp.',
    'Responda em portugues do Brasil, de forma clara, cordial e objetiva.',
    'Como as respostas sao lidas no WhatsApp, seja breve: evite textos longos,',
    'use frases curtas e, quando fizer sentido, listas simples.',
    'Ainda nao ha integracoes conectadas (bancos, ERPs, CRMs). Se pedirem uma',
    'acao que dependa de uma integracao, explique de forma amigavel que essa',
    'conexao ainda sera configurada, sem inventar dados.',
  ].join(' ');

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.model =
      this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-4-8';
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Gera uma resposta da IA para uma mensagem do usuario.
   * @param userMessage texto enviado pelo usuario
   * @returns resposta em texto para enviar de volta
   */
  async generateReply(userMessage: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: this.systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      // A resposta vem como blocos de conteudo; concatenamos os blocos de texto.
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      return text || 'Desculpe, nao consegui gerar uma resposta agora.';
    } catch (error: any) {
      const details = error?.message ?? error;
      this.logger.error(`Falha ao chamar a IA: ${JSON.stringify(details)}`);
      // Em caso de erro, devolvemos uma mensagem amigavel (nao vazamos o erro).
      return 'Tive um problema para processar sua mensagem agora. Pode tentar de novo em instantes?';
    }
  }
}
