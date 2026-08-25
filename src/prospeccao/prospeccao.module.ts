import { Module } from '@nestjs/common';
import { GoogleModule } from '../integrations/google/google.module';
import { MetricasModule } from '../metricas/metricas.module';
import { ProspeccaoService } from './prospeccao.service';
import { ProspeccaoTools } from './prospeccao.tools';

/**
 * Prospeccao por e-mail.
 *
 * Modulo proprio, e nao um punhado de ferramentas dentro do Google, porque o
 * que ele adiciona nao e capacidade de envio — isso o GoogleModule ja tem. E
 * a memoria de quem foi contatado, quem pediu para sair e quanto ja saiu hoje.
 * Essa regra e do negocio, nao da integracao, e vive melhor separada.
 */
@Module({
  imports: [GoogleModule, MetricasModule],
  providers: [ProspeccaoService, ProspeccaoTools],
  exports: [ProspeccaoService],
})
export class ProspeccaoModule {}
