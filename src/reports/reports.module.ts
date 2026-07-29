import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WhatsappModule } from '../integrations/whatsapp/whatsapp.module';
import { ReportScheduleService } from './report-schedule.service';
import { DailyReportService } from './daily-report.service';
import { ReportTools } from './report.tools';

/**
 * Resumo diario proativo: o Kyrius envia o panorama do negocio sozinho,
 * no horario escolhido por cada organizacao.
 *
 * Importa AiModule (gera o texto) e WhatsappModule (entrega). O agendamento
 * em si vem do ScheduleModule, registrado uma unica vez no AppModule.
 */
@Module({
  imports: [AiModule, WhatsappModule],
  providers: [ReportScheduleService, DailyReportService, ReportTools],
  exports: [DailyReportService, ReportScheduleService],
})
export class ReportsModule {}
