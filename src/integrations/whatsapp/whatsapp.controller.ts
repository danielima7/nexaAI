import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { WhatsappService } from './whatsapp.service';

/**
 * Controller do webhook do WhatsApp.
 *
 * A Meta chama este endpoint em dois momentos:
 *  - GET  /webhook  -> uma unica vez, para VERIFICAR o endpoint (handshake).
 *  - POST /webhook  -> toda vez que um evento acontece (ex: mensagem recebida).
 */
@Controller('webhook')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verificacao do webhook (handshake).
   * A Meta envia hub.mode, hub.verify_token e hub.challenge.
   * Se o verify_token bater com o nosso, devolvemos o challenge em texto puro.
   */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Webhook verificado com sucesso pela Meta.');
      return res.status(200).send(challenge);
    }

    this.logger.warn('Falha na verificacao do webhook (token invalido).');
    return res.sendStatus(403);
  }

  /**
   * Recebe os eventos de mensagem.
   *
   * Importante: respondemos 200 imediatamente (exigencia da Meta, senao ela
   * fica reenviando o evento). O processamento e delegado ao service.
   */
  @Post()
  @HttpCode(200)
  async receive(@Body() payload: any) {
    // Log resumido para acompanharmos o que chega (util no desenvolvimento)
    this.logger.debug(`Evento recebido: ${JSON.stringify(payload)}`);

    // Delegamos o tratamento ao service (nao travamos a resposta 200)
    this.whatsappService.handleIncomingEvent(payload).catch((err) => {
      this.logger.error('Erro ao processar evento do WhatsApp', err);
    });

    return { received: true };
  }
}
