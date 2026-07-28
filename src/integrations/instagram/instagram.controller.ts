import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InstagramService } from './instagram.service';
import { ConnectionsService } from '../../connections/connections.service';

/**
 * Rotas do fluxo OAuth do Instagram (autorizacao por organizacao).
 *
 * Fluxo multi-tenant, igual ao do Google:
 *  1. Usuario abre  /instagram/auth?org=<organizationId>
 *  2. Meta volta em /instagram/callback?code=...&state=<organizationId>
 *  3. Guardamos o Page Access Token na conexao daquela organizacao
 */
@Controller('instagram')
export class InstagramController {
  private readonly logger = new Logger(InstagramController.name);

  constructor(
    private readonly instagram: InstagramService,
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

  private pagina(titulo: string, corpo: string): string {
    return `<html><body style="font-family:sans-serif;max-width:640px;margin:40px auto">
      <h2>${titulo}</h2>${corpo}</body></html>`;
  }

  /** Inicia a autorizacao. `org` (opcional) identifica a organizacao. */
  @Get('auth')
  auth(@Query('org') org: string, @Res() res: Response): void {
    if (!this.instagram.isConfigured()) {
      res
        .status(400)
        .send('Configure META_APP_ID e META_APP_SECRET no .env primeiro.');
      return;
    }
    res.redirect(this.instagram.generateAuthUrl(this.cleanOrg(org)));
  }

  /** Callback da Meta: troca o code por token e salva na organizacao. */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error_description') erro: string,
    @Res() res: Response,
  ): Promise<void> {
    if (erro) {
      res.status(400).send(this.pagina('Autorizacao negada', `<p>${erro}</p>`));
      return;
    }
    if (!code) {
      res
        .status(400)
        .send(this.pagina('Codigo ausente', '<p>Codigo de autorizacao ausente.</p>'));
      return;
    }

    try {
      const { token, conta } = await this.instagram.exchangeCode(code);
      const org = this.cleanOrg(state);

      if (org) {
        await this.connections.set(org, 'instagram', { token });
        this.logger.log(
          `Instagram conectado para a organizacao ${org} (@${conta.username ?? conta.id}).`,
        );
        res.send(
          this.pagina(
            '✅ Instagram conectado!',
            `<p>A conta <b>@${conta.username ?? conta.id}</b> (Pagina "${conta.pagina ?? '—'}")
             foi conectada ao Kyrius. Pode fechar esta pagina e voltar ao WhatsApp.</p>`,
          ),
        );
        return;
      }

      // Sem organizacao no state (modo legado): mostra o token para o .env.
      this.logger.log('==== INSTAGRAM_ACCESS_TOKEN (sem org) ====');
      res.send(
        this.pagina(
          'Instagram autorizado',
          `<p>Conta <b>@${conta.username ?? conta.id}</b>. Token de Pagina abaixo
           (modo legado, sem organizacao):</p>
           <textarea style="width:100%;height:90px">${token}</textarea>`,
        ),
      );
    } catch (e: any) {
      this.logger.error(`Falha no callback do Instagram: ${e?.message}`);
      res
        .status(500)
        .send(
          this.pagina(
            'Erro na autorizacao',
            `<p>${e?.message ?? 'Erro desconhecido.'} Veja o log do backend.</p>`,
          ),
        );
    }
  }
}
