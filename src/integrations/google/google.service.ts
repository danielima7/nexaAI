import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

/**
 * Service da integracao com o Google (Gmail + Google Agenda/Calendar).
 *
 * Tambem funciona como provedor de autenticacao para os demais produtos
 * Google do Katalli (ex: SheetsService), que reutilizam o mesmo consentimento.
 *
 * Multi-tenant: o client_id/client_secret sao do app (globais), mas o
 * refresh_token e POR ORGANIZACAO. Cada metodo recebe o refreshToken da org
 * (resolvido pelo ConnectionsService — conta da org ou fallback do .env).
 */
@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);

  /**
   * Permissoes pedidas na tela de consentimento.
   *
   * ATENCAO: ao mudar esta lista, o refresh_token ja emitido NAO ganha os
   * novos escopos — a organizacao precisa reconectar o Google (/google/auth).
   *
   * `drive.metadata.readonly` permite apenas descobrir as planilhas do usuario
   * (nome/id) para localiza-las pelo nome; nao le o conteudo de outros
   * arquivos do Drive. O conteudo das planilhas vem pelo escopo `spreadsheets`.
   */
  static readonly SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ];

  constructor(private readonly config: ConfigService) {}

  /** As credenciais OAuth do app (client id/secret) estao configuradas? */
  isConfigured(): boolean {
    const id = this.config.get<string>('GOOGLE_CLIENT_ID');
    const secret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    return (
      !!id &&
      !!secret &&
      id !== 'COLE_AQUI_O_CLIENT_ID' &&
      secret !== 'COLE_AQUI_O_CLIENT_SECRET'
    );
  }

  /** Cliente OAuth base (sem credenciais de usuario). */
  private oauthClient() {
    return new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  /** URL de consentimento. `state` carrega a organizacao que esta conectando. */
  generateAuthUrl(state?: string): string {
    return this.oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GoogleService.SCOPES,
      state,
    });
  }

  /** Troca o "code" pelos tokens (contem o refresh_token). */
  async exchangeCode(code: string): Promise<any> {
    const { tokens } = await this.oauthClient().getToken(code);
    return tokens;
  }

  /**
   * Cliente OAuth autenticado com o refresh_token informado.
   * Publico porque os outros services do Google (ex: Sheets) reutilizam
   * o mesmo consentimento desta conta.
   */
  authorizedClient(refreshToken: string) {
    const client = this.oauthClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  // ---------- Gmail ----------

  async listEmails(
    refreshToken: string,
    maxResults = 10,
    query?: string,
  ): Promise<any[]> {
    const gmail = google.gmail({
      version: 'v1',
      auth: this.authorizedClient(refreshToken),
    });
    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query,
    });
    const messages = list.data.messages ?? [];
    return Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: m.id as string,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From'],
        });
        const headers = msg.data.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h) => h.name === name)?.value ?? '';
        return {
          id: m.id,
          from: get('From'),
          subject: get('Subject'),
          snippet: msg.data.snippet ?? '',
        };
      }),
    );
  }

  async sendEmail(
    refreshToken: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<any> {
    const gmail = google.gmail({
      version: 'v1',
      auth: this.authorizedClient(refreshToken),
    });
    const raw = Buffer.from(
      [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        body,
      ].join('\n'),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return res.data;
  }

  // ---------- Google Agenda (Calendar) ----------

  async listUpcomingEvents(refreshToken: string, maxResults = 10): Promise<any[]> {
    const calendar = google.calendar({
      version: 'v3',
      auth: this.authorizedClient(refreshToken),
    });
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return res.data.items ?? [];
  }

  async createEvent(
    refreshToken: string,
    params: { summary: string; start: string; end: string; description?: string },
  ): Promise<any> {
    const calendar = google.calendar({
      version: 'v3',
      auth: this.authorizedClient(refreshToken),
    });
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.start, timeZone: 'America/Sao_Paulo' },
        end: { dateTime: params.end, timeZone: 'America/Sao_Paulo' },
      },
    });
    return res.data;
  }
}
