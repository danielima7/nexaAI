import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { InstagramService } from './instagram.service';
import { InstagramDmService } from './instagram-dm.service';
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
    private readonly dm: InstagramDmService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Handshake do webhook: a Meta chama uma vez, ao configurar, e espera receber
   * de volta o `hub.challenge` — desde que o verify token bata.
   */
  @Get('webhook')
  verificarWebhook(
    @Query('hub.mode') modo: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') desafio: string,
    @Res() res: Response,
  ): void {
    const esperado = this.config.get<string>('INSTAGRAM_VERIFY_TOKEN');

    if (modo === 'subscribe' && esperado && token === esperado) {
      res.status(200).send(desafio);
      return;
    }

    this.logger.warn('Handshake do webhook do Instagram recusado.');
    res.status(403).send('Verificacao falhou.');
  }

  /**
   * Recebe mensagens do Direct.
   *
   * Responde 200 imediatamente e processa depois: a Meta reenvia o evento se a
   * resposta demorar, e gerar a resposta da IA leva segundos — sem isso, uma
   * mesma mensagem seria respondida varias vezes.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receberWebhook(@Req() req: RawBodyRequest<Request>): string {
    const corpoBruto = req.rawBody?.toString('utf8') ?? '';
    const assinatura = req.headers['x-hub-signature-256'] as string | undefined;

    // Sem validar a assinatura, qualquer um poderia postar aqui e fazer a IA
    // gastar tokens — ou responder em nome de um cliente.
    if (!this.instagram.assinaturaValida(corpoBruto, assinatura)) {
      this.logger.warn('Webhook do Instagram com assinatura invalida — ignorado.');
      return 'EVENT_RECEIVED';
    }

    const mensagens = this.dm.extrairMensagens(req.body);

    for (const mensagem of mensagens) {
      // Deliberadamente sem await: a resposta HTTP nao espera a IA.
      this.dm.processar(mensagem).catch((e) => {
        this.logger.error(`Falha ao processar Direct: ${e?.message ?? e}`);
      });
    }

    return 'EVENT_RECEIVED';
  }

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
        // Guardamos o id da conta junto do token: o webhook do Direct chega
        // identificado pela conta que recebeu, e e assim que descobrimos de
        // qual organizacao e a conversa.
        await this.connections.set(org, 'instagram', {
          token,
          igUserId: conta.id,
          username: conta.username ?? null,
        });
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
