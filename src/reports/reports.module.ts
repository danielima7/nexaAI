import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WhatsappModule } from '../integrations/whatsapp/whatsapp.module';
import { GoogleModule } from '../integrations/google/google.module';
import { ReportScheduleService } from './report-schedule.service';
import { DailyReportService } from './daily-report.service';
import { ReportTools } from './report.tools';
import { NotificacaoService } from './notificacao.service';
import { AlertService } from './alert.service';
import { AlertTools } from './alert.tools';

/**
 * Avisos proativos: o Katalli falando sem ser perguntado.
 *
 * Duas formas, com custos bem diferentes:
 *  - RESUMO DIARIO: sai no horario marcado, sempre. Uma chamada de IA por dia.
 *  - ALERTA: verifica periodicamente e so avisa quando MUDA. A verificacao e
 *    codigo puro; a IA so entra para redigir o aviso.
 *
 * Ambos entregam pelo NotificacaoService, que usa a conta Google que a
 * organizacao ja autorizou.
 */
@Module({
  imports: [AiModule, WhatsappModule, GoogleModule],
  providers: [
    NotificacaoService,
    ReportScheduleService,
    DailyReportService,
    ReportTools,
    AlertService,
    AlertTools,
  ],
  exports: [DailyReportService, ReportScheduleService, AlertService],
})
export class ReportsModule {}
