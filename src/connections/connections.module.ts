import { Global, Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { ConnectionsController } from './connections.controller';
import { ChatModule } from '../chat/chat.module';

/**
 * Modulo global de conexoes (credenciais por organizacao).
 * Exposto globalmente para que qualquer integracao resolva a credencial
 * da organizacao no momento da chamada.
 *
 * Importa o ChatModule apenas para reaproveitar o ChatAuthService na tela de
 * integracoes — assim o cliente usa a mesma sessao do chat.
 */
@Global()
@Module({
  imports: [ChatModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
