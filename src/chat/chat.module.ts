import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatAuthService } from './chat-auth.service';
import { ChatAccountService } from './chat-account.service';
import { AiModule } from '../ai/ai.module';

/**
 * Modulo do Chat Web. Reaproveita o AiModule (IA + memoria) e o TenantService
 * global. Serve a pagina do chat, o login e o endpoint de mensagens.
 */
@Module({
  imports: [AiModule],
  controllers: [ChatController],
  providers: [ChatAuthService, ChatAccountService],
  exports: [ChatAccountService],
})
export class ChatModule {}
