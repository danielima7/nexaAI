import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GoogleService } from './google.service';
import { ConnectionsService } from '../../connections/connections.service';

/**
 * Rotas do fluxo OAuth do Google (autorizacao por organizacao).
 *
 * Fluxo multi-tenant:
 *  1. Usuario abre  /google/auth?org=<organizationId>
 *  2. Google volta em /google/callback?code=...&state=<organizationId>
 *  3. Guardamos o refresh_token na conexao daquela organizacao (Connection)
 */
@Controller('google')
export class GoogleController {
  private readonly logger = new Logger(GoogleController.name);

  constructor(
    private readonly google: GoogleService,
    private readonly connections: ConnectionsService,
  ) {}

  /** Extrai apenas o UUID de um valor (protege contra lixo, ex: "id**"). */
  private cleanOrg(raw?: string): string | undefined {
    if (!raw) return undefined;
    const m = raw.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    return m ? m[0] : undefined;
  }

  /** Inicia a autorizacao. `org` (opcional) identifica a organizacao. */
  @Get('auth')
  auth(@Query('org') org: string, @Res() res: Response): void {
    if (!this.google.isConfigured()) {
      res
        .status(400)
        .send('Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env primeiro.');
      return;
    }
    res.redirect(this.google.generateAuthUrl(this.cleanOrg(org)));
  }

  /** Callback do Google: troca o code por tokens e salva na organizacao. */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      res.status(400).send(`Autorizacao negada: ${error}`);
      return;
    }
    if (!code) {
      res.status(400).send('Codigo de autorizacao ausente.');
      return;
    }
    try {
      const tokens = await this.google.exchangeCode(code);
      const refresh = tokens.refresh_token;
      const org = this.cleanOrg(state);

      if (refresh && org) {
        // Autorizacao vinculada a uma organizacao: guarda a credencial.
        await this.connections.set(org, 'google', { token: refresh });
        this.logger.log(`Google conectado para a organizacao ${org}.`);
        res.send(
          `<html><body style="font-family:sans-serif;max-width:640px;margin:40px auto">
            <h2>✅ Google conectado!</h2>
            <p>Sua conta Google foi conectada ao Kyrius para a sua organizacao.
            Pode fechar esta pagina e voltar ao WhatsApp.</p>
          </body></html>`,
        );
        return;
      }

      // Sem organizacao no state (modo legado single-user): mostra o token.
      if (refresh) {
        this.logger.log('==== GOOGLE_REFRESH_TOKEN (sem org) ====');
        this.logger.log(refresh);
      }
      res.send(
        `<html><body style="font-family:sans-serif;max-width:640px;margin:40px auto">
          <h2>Google autorizado</h2>
          <p>Refresh token abaixo (modo legado, sem organizacao):</p>
          <textarea style="width:100%;height:90px">${refresh ?? '(nenhum refresh_token — revogue o acesso em myaccount.google.com/permissions e tente de novo)'}</textarea>
        </body></html>`,
      );
    } catch (e: any) {
      const details = e?.response?.data ?? e?.message ?? e;
      this.logger.error(`Falha ao trocar code por tokens: ${JSON.stringify(details)}`);
      res.status(500).send('Erro ao concluir a autorizacao. Veja o log do backend.');
    }
  }
}
