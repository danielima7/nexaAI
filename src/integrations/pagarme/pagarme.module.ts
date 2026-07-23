import { Module } from '@nestjs/common';
import { PagarmeService } from './pagarme.service';
import { PagarmeTools } from './pagarme.tools';

/**
 * Modulo isolado da integracao com o Pagar.me (grupo Stone, pagamentos).
 * Mesmo padrao multi-tenant das demais integracoes.
 */
@Module({
  providers: [PagarmeService, PagarmeTools],
})
export class PagarmeModule {}
