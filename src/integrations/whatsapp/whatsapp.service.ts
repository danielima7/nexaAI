import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiService } from '../../ai/ai.service';
import { ConversationMemoryService } from '../../ai/conversation-memory.service';
import { TenantService } from '../../tenant/tenant.service';
import { ConsentimentoService } from '../../whatsapp-envio/consentimento.service';

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
    private readonly memory: ConversationMemoryService,
    private readonly tenant: TenantService,
    private readonly consentimento: ConsentimentoService,
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

    // 0. Resolve (ou cria) a organizacao e o usuario deste numero (multi-tenant).
    const { user, organization } = await this.tenant.resolveByWhatsapp(from);
    const scope = { organizationId: organization.id, userId: user.id };

    // 0.1. Abre a janela de 24h. Precisa vir ANTES da resposta: a plataforma so
    //      aceita texto livre dentro dela, e quem envia e o mesmo fluxo abaixo.
    await this.consentimento.registrarEntrada(organization.id, from);

    // 1. Guarda a mensagem do usuario no historico da conversa (escopada).
    await this.memory.append(from, { role: 'user', content: text }, scope);

    // 2. Pergunta a IA (Claude) considerando TODO o historico do contato.
    //    Passa contato + organizacao + usuario como contexto (auditoria/tools).
    const history = await this.memory.getHistory(from);
    const reply = await this.ai.generateReply('whatsapp', history, {
      contact: from,
      ...scope,
    });

    // 3. Guarda a resposta da IA no historico (para lembrar no proximo turno).
    await this.memory.append(from, { role: 'assistant', content: reply }, scope);

    // 4. Envia a resposta ao usuario.
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
