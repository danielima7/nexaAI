import { Global, Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';

/**
 * Modulo global de conexoes (credenciais por organizacao).
 * Exposto globalmente para que qualquer integracao resolva a credencial
 * da organizacao no momento da chamada.
 */
@Global()
@Module({
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
