import { Global, Module } from '@nestjs/common';
import { TenantService } from './tenant.service';

/**
 * Modulo global de multi-tenant. Expoe o TenantService (resolve organizacao
 * e usuario pelo WhatsApp) para os demais modulos.
 */
@Global()
@Module({
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
