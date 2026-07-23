import { Module } from '@nestjs/common';
import { GoogleService } from './google.service';
import { GoogleTools } from './google.tools';
import { GoogleController } from './google.controller';

/**
 * Modulo isolado da integracao com o Google (Gmail + Google Agenda).
 * Expoe o fluxo OAuth (GoogleController) e registra as ferramentas no
 * ToolRegistry global (quando ja autorizado).
 */
@Module({
  controllers: [GoogleController],
  providers: [GoogleService, GoogleTools],
})
export class GoogleModule {}
