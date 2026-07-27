import { Module } from '@nestjs/common';
import { GoogleService } from './google.service';
import { GoogleTools } from './google.tools';
import { GoogleController } from './google.controller';
import { SheetsService } from './sheets.service';
import { SheetsTools } from './sheets.tools';

/**
 * Modulo isolado da integracao com o Google (Gmail + Agenda + Planilhas).
 * Expoe o fluxo OAuth (GoogleController) e registra as ferramentas no
 * ToolRegistry global (quando ja autorizado). Os tres produtos compartilham
 * o mesmo consentimento: a organizacao autoriza o Google uma unica vez.
 */
@Module({
  controllers: [GoogleController],
  providers: [GoogleService, GoogleTools, SheetsService, SheetsTools],
})
export class GoogleModule {}
