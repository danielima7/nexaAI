import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { ConversationMemoryService } from '../../ai/conversation-memory.service';
import { ConnectionsService } from '../../connections/connections.service';
import { InstagramService } from './instagram.service';

/** Uma mensagem util extraida do webhook. */
interface MensagemDirect {
  /** Conta do Instagram que RECEBEU (identifica a organizacao). */
  contaId: string;
  /** IGSID de quem escreveu — opaco e valido apenas para esta conta. */
  remetente: string;
  texto: string;
}

/**
 * Atendimento por Direct do Instagram.
 *
 * Diferenca essencial para o WhatsApp: aqui quem escreve NAO e o dono da
 * empresa — e um cliente dele. Por isso a conversa roda com `audience: 'public'`,
 * que deixa a IA sem nenhuma ferramenta (as 52 sao `owner`) e troca o prompt
 * para o papel de atendimento.
 *
 * O seguidor tambem nao vira usuario nem organizacao: a conversa e guardada com
 * `contact = "ig:<igsid>"` e o `organizationId` da conta que recebeu. Ele e uma
 * chave de conversa, nao um inquilino da plataforma.
 */
@Injectable()
export class InstagramDmService {
  private readonly logger = new Logger(InstagramDmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly memory: ConversationMemoryService,
    private readonly connections: ConnectionsService,
    private readonly instagram: InstagramService,
  ) {}

  /**
   * Extrai as mensagens de texto reais de um payload de webhook.
   *
   * Ignora "echoes" — as mensagens que NOS enviamos voltam pelo mesmo webhook.
   * Sem esse filtro, o bot responderia a si mesmo em laco infinito.
   */
  extrairMensagens(payload: any): MensagemDirect[] {
    const mensagens: MensagemDirect[] = [];

    for (const entry of payload?.entry ?? []) {
      for (const evento of entry?.messaging ?? []) {
        const texto = evento?.message?.text;
        if (!texto) continue;
        if (evento.message?.is_echo) continue;
        if (!evento.sender?.id) continue;

        mensagens.push({
          contaId: String(entry.id),
          remetente: String(evento.sender.id),
          texto: String(texto),
        });
      }
    }

    return mensagens;
  }

  /** Processa uma mensagem recebida: entende, responde e registra. */
  async processar(mensagem: MensagemDirect): Promise<void> {
    const organizationId = await this.connections.acharOrganizacaoPor(
      'instagram',
      'igUserId',
      mensagem.contaId,
    );
    if (!organizationId) {
      this.logger.warn(
        `Direct recebido para a conta ${mensagem.contaId}, que nao pertence a nenhuma organizacao conectada.`,
      );
      return;
    }

    const organizacao = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    // Sem instrucoes escritas pelo dono, o atendimento fica desligado. E
    // deliberado: melhor nao responder do que responder qualquer coisa em nome
    // da empresa de alguem.
    const instrucoes = organizacao?.atendimentoInstrucoes?.trim();
    if (!instrucoes) {
      this.logger.log(
        `Atendimento publico desligado para a organizacao ${organizationId} (sem instrucoes).`,
      );
      return;
    }

    const token = await this.connections.resolveToken(
      { organizationId },
      'instagram',
      'INSTAGRAM_ACCESS_TOKEN',
    );
    if (!token) {
      this.logger.warn(
        `Sem credencial do Instagram para a organizacao ${organizationId}.`,
      );
      return;
    }

    const contact = `ig:${mensagem.remetente}`;
    const escopo = { organizationId };

    await this.memory.append(
      contact,
      { role: 'user', content: mensagem.texto },
      escopo,
    );
    const historico = await this.memory.getHistory(contact);

    const resposta = await this.ai.generateReply('instagram_dm', historico, {
      contact,
      organizationId,
      audience: 'public',
      instrucoesPublicas: instrucoes,
    });

    await this.memory.append(
      contact,
      { role: 'assistant', content: resposta },
      escopo,
    );

    await this.instagram.responderDirect(token, mensagem.remetente, resposta);
    this.logger.log(
      `Direct respondido para ${contact} (organizacao ${organizationId}).`,
    );
  }
}
