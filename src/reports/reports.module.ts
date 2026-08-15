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
import { MonitorCustoService } from './monitor-custo.service';
import { MonitorCreditoService } from './monitor-credito.service';
import { MonitorConexoesService } from './monitor-conexoes.service';
import { SaudeModule } from '../saude/saude.module';

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
 *
 * Os dois monitores sao de outra natureza: avisam VOCE, nao o cliente, e moram
 * aqui por reaproveitarem o mesmo canal de e-mail.
 *  - MonitorCustoService: gasto do dia passou do teto (dinheiro saindo rapido).
 *  - MonitorCreditoService: a IA parou de atender todo mundo (produto fora do
 *    ar). Um nao cobre o outro: saldo que acaba devagar nunca encosta no teto.
 */
@Module({
  imports: [AiModule, WhatsappModule, GoogleModule, SaudeModule],
  providers: [
    NotificacaoService,
    ReportScheduleService,
    DailyReportService,
    ReportTools,
    AlertService,
    AlertTools,
    MonitorCustoService,
    MonitorCreditoService,
    MonitorConexoesService,
  ],
  exports: [DailyReportService, ReportScheduleService, AlertService],
})
export class ReportsModule {}
