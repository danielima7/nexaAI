import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiService } from '../../ai/ai.service';

/**
 * Service da integracao com o WhatsApp Business Platform (Meta Cloud API).
 *
 * Responsabilidades nesta fase (eco simples):
 *  - interpretar o evento recebido pelo webhook;
 *  - extrair a mensagem de texto e o remetente;
 *  - responder com um "eco" (echo) confirmando o recebimento.
 *
 * Nas proximas fases, o "eco" sera substituido pela chamada a IA.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ai: AiService,
  ) {}

  /**
   * Processa um evento recebido da Meta.
   * A estrutura do payload segue o formato oficial da Cloud API:
   * entry[].changes[].value.messages[]
   */
  async handleIncomingEvent(payload: any): Promise<void> {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    // Nem todo evento e uma mensagem (ex: status de entrega). Ignoramos esses.
    if (!message) {
      this.logger.debug('Evento sem mensagem de texto. Ignorado.');
      return;
    }

    const from = message.from as string; // numero de quem enviou
    const text = message.text?.body as string | undefined;

    if (!text) {
      this.logger.debug(`Mensagem de ${from} sem texto. Ignorada.`);
      return;
    }

    this.logger.log(`Mensagem de ${from}: "${text}"`);

    // Pergunta a IA (Claude) como responder e devolve a resposta ao usuario.
    const reply = await this.ai.generateReply(text);
    await this.sendTextMessage(from, reply);
  }

  /**
   * Envia uma mensagem de texto para um numero via Graph API da Meta.
   */
  async sendTextMessage(to: string, body: string): Promise<void> {
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const apiVersion =
      this.config.get<string>('WHATSAPP_API_VERSION') ?? 'v21.0';

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Resposta enviada para ${to}: "${body}"`);
    } catch (error: any) {
      // A Meta retorna detalhes uteis no corpo do erro; logamos para diagnostico.
      const details = error?.response?.data ?? error?.message;
      this.logger.error(
        `Falha ao enviar mensagem para ${to}: ${JSON.stringify(details)}`,
      );
      throw error;
    }
  }
}
