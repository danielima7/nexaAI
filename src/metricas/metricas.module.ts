import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { InstagramModule } from '../integrations/instagram/instagram.module';
import { HubspotModule } from '../integrations/hubspot/hubspot.module';
import { MetricaService } from './metrica.service';
import { ColetorMetricasService } from './coletor-metricas.service';

/**
 * Historico dos numeros do cliente.
 *
 * Modulo proprio, separado do Painel, porque a responsabilidade e outra: aqui
 * se MEDE e se guarda; la se desenha. A coleta precisa rodar todo dia mesmo
 * que o cliente nunca abra o painel — se ela dependesse da tela, o historico
 * so existiria para quem visita, que e o contrario do necessario.
 */
@Module({
  imports: [ConnectionsModule, InstagramModule, HubspotModule],
  providers: [MetricaService, ColetorMetricasService],
  exports: [MetricaService, ColetorMetricasService],
})
export class MetricasModule {}
