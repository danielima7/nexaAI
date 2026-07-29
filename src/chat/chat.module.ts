import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { InviteController } from './invite.controller';
import { ChatAuthService } from './chat-auth.service';
import { ChatAccountService } from './chat-account.service';
import { InviteService } from './invite.service';
import { AiModule } from '../ai/ai.module';

/**
 * Modulo do Chat Web. Reaproveita o AiModule (IA + memoria) e o TenantService
 * global. Serve a pagina do chat, o login, o aceite de convites e o endpoint
 * de mensagens.
 */
@Module({
  imports: [AiModule],
  controllers: [ChatController, InviteController],
  providers: [ChatAuthService, ChatAccountService, InviteService],
  // ChatAuthService e exportado para a tela de integracoes reaproveitar a
  // mesma sessao do chat, sem exigir um segundo login.
  exports: [ChatAccountService, InviteService, ChatAuthService],
})
export class ChatModule {}
