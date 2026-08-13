import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { GoogleModule } from '../integrations/google/google.module';
import { ChatModule } from '../chat/chat.module';
import { HubspotModule } from '../integrations/hubspot/hubspot.module';
import { MetricasModule } from '../metricas/metricas.module';
import { PainelService } from './painel.service';
import { PainelTools } from './painel.tools';
import { PainelController } from './painel.controller';

/**
 * Painel: os graficos fixos que o cliente acompanha.
 *
 * Modulo proprio, e nao mais um pedaco do chat, por dois motivos:
 *
 * 1. O chat ja tem 700 linhas de HTML em string. Enfiar dashboard ali dentro
 *    deixaria o arquivo impossivel de manter.
 * 2. A fonte de dados vai crescer (planilha hoje; financeiro e CRM depois).
 *    Isso pertence a um modulo com fronteira propria, nao a um controller de
 *    conversa.
 */
@Module({
  // ChatModule entra pelo ChatAuthService: o painel reaproveita a sessao do
  // chat, para o cliente nao fazer um segundo login so para ver um grafico.
  imports: [
    ConnectionsModule,
    GoogleModule,
    ChatModule,
    // HubSpot para o funil ao vivo; Metricas para as series historicas.
    HubspotModule,
    MetricasModule,
  ],
  controllers: [PainelController],
  providers: [PainelService, PainelTools],
  exports: [PainelService],
})
export class PainelModule {}
