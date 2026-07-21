import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeTools } from './stripe.tools';

/**
 * Modulo isolado da integracao com o Stripe (pagamentos).
 * Segue o mesmo padrao das demais integracoes: registra suas ferramentas
 * no ToolRegistry global, sem alterar a IA nem o WhatsApp.
 */
@Module({
  providers: [StripeService, StripeTools],
})
export class StripeModule {}
