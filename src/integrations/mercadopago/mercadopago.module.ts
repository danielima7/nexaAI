import { Module } from '@nestjs/common';
import { MercadopagoService } from './mercadopago.service';
import { MercadopagoTools } from './mercadopago.tools';

/**
 * Modulo isolado da integracao com o Mercado Pago (pagamentos BR).
 * Mesmo padrao das demais: registra ferramentas no ToolRegistry global.
 */
@Module({
  providers: [MercadopagoService, MercadopagoTools],
})
export class MercadopagoModule {}
