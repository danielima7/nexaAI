import { Global, Module } from '@nestjs/common';
import { SuporteService } from './suporte.service';

/**
 * Canal de suporte (WhatsApp). @Global porque e transversal: aparece no chat
 * e no rodape dos avisos por e-mail, e tende a aparecer em qualquer tela nova
 * — importar em cada modulo so acumularia ruido.
 */
@Global()
@Module({
  providers: [SuporteService],
  exports: [SuporteService],
})
export class SuporteModule {}
