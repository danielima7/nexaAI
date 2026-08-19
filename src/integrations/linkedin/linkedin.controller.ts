import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LinkedinService } from './linkedin.service';
import { ConnectionsService } from '../../connections/connections.service';

/**
 * Fluxo OAuth do LinkedIn, por organizacao.
 *
 *  1. O cliente abre /linkedin/auth?org=<organizationId>
 *  2. O LinkedIn devolve em /linkedin/callback?code=...&state=<organizationId>
 *  3. Trocamos o code por token, descobrimos o URN do autor e guardamos os
 *     dois juntos na conexao daquela organizacao.
 *
 * O URN e resolvido AQUI, e nao na hora de publicar, porque o teto do LinkedIn
 * e de 150 requisicoes por membro por dia: gastar uma delas para redescobrir
 * um identificador que nunca muda seria desperdicio.
 */
@Controller('linkedin')
export class LinkedinController {
  private readonly logger = new Logger(LinkedinController.name);

  constructor(
    private readonly linkedin: LinkedinService,
    private readonly connections: ConnectionsService,
  ) {}

  /** Extrai apenas o UUID (protege contra lixo no parametro). */
  private cleanOrg(raw?: string): string | undefined {
    const m = (raw ?? '').match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    return m ? m[0] : undefined;
  }

  @Get('auth')
  auth(@Query('org') org: string, @Res() res: Response): void {
    if (!this.linkedin.isConfigured()) {
      res
        .status(400)
        .send('Configure LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET no .env primeiro.');
      return;
    }
    res.redirect(this.linkedin.generateAuthUrl(this.cleanOrg(org)));
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      this.logger.warn(`Autorizacao recusada: ${error} — ${errorDescription}`);
      res.status(400).send(`Autorizacao negada: ${error}`);
      return;
    }
    if (!code) {
      res.status(400).send('Codigo de autorizacao ausente.');
      return;
    }

    const org = this.cleanOrg(state);
    if (!org) {
      res
        .status(400)
        .send('Nao consegui identificar a organizacao. Refaca a conexao pela pagina de Integracoes.');
      return;
    }

    try {
      const tokens = await this.linkedin.exchangeCode(code);
      const membro = await this.linkedin.getMembro(tokens.access_token);

      if (!membro.sub) {
        throw new Error('O LinkedIn nao devolveu o identificador do membro.');
      }

      // `expires_in` vem em segundos (~60 dias). Guardamos a data absoluta
      // para a tela de integracoes poder avisar ANTES de o cliente descobrir
      // que o post nao saiu.
      const expiraEm = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined;

      await this.connections.set(org, 'linkedin', {
        token: tokens.access_token,
        urn: `urn:li:person:${membro.sub}`,
        nome: membro.nome,
        expiraEm,
      });

      this.logger.log(`LinkedIn conectado para a organizacao ${org}.`);

      res.send(
        `<html><body style="font-family:sans-serif;max-width:640px;margin:40px auto">
          <h2>✅ LinkedIn conectado!</h2>
          <p>A conta${membro.nome ? ` de <b>${membro.nome}</b>` : ''} foi conectada ao Katalli.
          Agora você pode pedir no chat para publicar.</p>
          <p style="color:#555;font-size:14px">A autorização do LinkedIn vale cerca de
          60 dias. Depois disso será necessário reconectar — avisaremos na página
          de Integrações.</p>
          <p><a href="/integracoes">Voltar às Integrações</a></p>
        </body></html>`,
      );
    } catch (e: any) {
      const detalhe = e?.response?.data ?? e?.message ?? e;
      this.logger.error(`Falha ao concluir a conexao: ${JSON.stringify(detalhe)}`);
      res.status(500).send('Erro ao concluir a autorizacao. Veja o log do backend.');
    }
  }
}
