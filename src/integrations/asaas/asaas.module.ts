import { Module } from '@nestjs/common';
import { AsaasService } from './asaas.service';
import { AsaasTools } from './asaas.tools';

/**
 * Modulo isolado da integracao com o Asaas (financeiro/cobrancas BR).
 * Mesmo padrao das demais: registra ferramentas no ToolRegistry global.
 */
@Module({
  providers: [AsaasService, AsaasTools],
})
export class AsaasModule {}
