import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { GoogleService } from './google.service';

/**
 * Ferramentas do Google (Gmail + Agenda), multi-tenant. Cada execucao resolve
 * o refresh_token da organizacao (conta da org ou fallback do .env).
 * Tambem oferece uma ferramenta que gera o link de conexao (OAuth) da org.
 */
@Injectable()
export class GoogleTools implements OnModuleInit {
  private readonly logger = new Logger(GoogleTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly google: GoogleService,
    private readonly connections: ConnectionsService,
    private readonly config: ConfigService,
  ) {}

  private token(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(context, 'google', 'GOOGLE_REFRESH_TOKEN');
  }

  private naoConectado(): string {
    return 'O Google (Gmail/Agenda) ainda nao esta conectado para a sua organizacao. Peca o link de conexao do Google.';
  }

  onModuleInit(): void {
    if (!this.google.isConfigured()) {
      this.logger.warn(
        'Google nao configurado (client id/secret) — ferramentas do Google nao registradas.',
      );
      return;
    }

    // Ferramenta para gerar o link de conexao (OAuth) da organizacao.
    this.registry.register({
      definition: {
        name: 'katalli_conectar_google',
        description:
          'Gera o link para o usuario conectar a propria conta Google (Gmail + Agenda) a sua organizacao. Use quando o usuario pedir para conectar/autorizar o Google.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        if (!context?.organizationId)
          return 'Nao consegui identificar sua organizacao.';
        const redirect = this.config.get<string>('GOOGLE_REDIRECT_URI') ?? '';
        const authBase = redirect.replace('/google/callback', '/google/auth');
        const url = `${authBase}?org=${context.organizationId}`;
        return `Para conectar seu Google, abra este link no navegador e autorize (marque todas as permissoes):\n${url}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'gmail_listar_emails',
        description:
          'Lista e-mails recentes do Gmail (assunto, remetente e resumo). Aceita um termo de busca opcional. Use quando o usuario pedir para ver/consultar e-mails.',
        input_schema: {
          type: 'object',
          properties: {
            busca: { type: 'string', description: 'Filtro opcional (sintaxe do Gmail)' },
            limite: { type: 'number', description: 'Quantos e-mails (padrao 10)' },
          },
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const emails = await this.google.listEmails(token, input?.limite ?? 10, input?.busca);
        if (emails.length === 0) return 'Nenhum e-mail encontrado.';
        return `E-mails (${emails.length}):\n${emails
          .map((e) => `- De: ${e.from}\n  Assunto: ${e.subject}\n  ${e.snippet}`)
          .join('\n')}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'gmail_enviar_email',
        description:
          'Envia um e-mail pelo Gmail do usuario. Use quando o usuario pedir para enviar/mandar um e-mail.',
        input_schema: {
          type: 'object',
          properties: {
            para: { type: 'string', description: 'E-mail do destinatario' },
            assunto: { type: 'string', description: 'Assunto' },
            corpo: { type: 'string', description: 'Conteudo' },
          },
          required: ['para', 'assunto', 'corpo'],
        },
      },
      escrita: true,
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        await this.google.sendEmail(token, input.para, input.assunto, input.corpo);
        return `E-mail enviado para ${input.para} com o assunto "${input.assunto}".`;
      },
    });

    this.registry.register({
      definition: {
        name: 'google_agenda_proximos_eventos',
        description:
          'Lista os proximos eventos da Google Agenda do usuario. Use quando o usuario perguntar sobre a agenda ou compromissos.',
        input_schema: {
          type: 'object',
          properties: {
            limite: { type: 'number', description: 'Quantos eventos (padrao 10)' },
          },
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const eventos = await this.google.listUpcomingEvents(token, input?.limite ?? 10);
        if (eventos.length === 0) return 'Nenhum evento proximo na agenda.';
        return `Proximos eventos (${eventos.length}):\n${eventos
          .map((ev) => `- ${ev.summary ?? '(sem titulo)'} — ${ev.start?.dateTime ?? ev.start?.date ?? ''}`)
          .join('\n')}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'google_agenda_criar_evento',
        description:
          'Cria um evento na Google Agenda. Informe titulo e horarios de inicio e fim em ISO 8601 (ex: 2026-07-22T15:00:00). Fuso America/Sao_Paulo.',
        input_schema: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Titulo do evento' },
            inicio: { type: 'string', description: 'Inicio ISO 8601' },
            fim: { type: 'string', description: 'Fim ISO 8601' },
            descricao: { type: 'string', description: 'Descricao (opcional)' },
          },
          required: ['titulo', 'inicio', 'fim'],
        },
      },
      escrita: true,
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const ev = await this.google.createEvent(token, {
          summary: input.titulo,
          start: input.inicio,
          end: input.fim,
          description: input.descricao,
        });
        return `Evento "${ev.summary}" criado na agenda para ${input.inicio}.`;
      },
    });

    this.logger.log('Ferramentas do Google (Gmail + Agenda) registradas (multi-tenant).');
  }
}
