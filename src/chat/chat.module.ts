import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { InviteController } from './invite.controller';
import { ChatAuthService } from './chat-auth.service';
import { ChatAccountService } from './chat-account.service';
import { InviteService } from './invite.service';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { LimitadorTaxaService } from './limitador-taxa.service';
import { AiModule } from '../ai/ai.module';
import { UploadsModule } from '../uploads/uploads.module';

/**
 * Modulo do Chat Web. Reaproveita o AiModule (IA + memoria) e o TenantService
 * global. Serve a pagina do chat, o login, o aceite de convites e o endpoint
 * de mensagens.
 */
@Module({
  imports: [AiModule, UploadsModule],
  controllers: [ChatController, InviteController, SignupController],
  providers: [
    ChatAuthService,
    ChatAccountService,
    InviteService,
    SignupService,
    LimitadorTaxaService,
  ],
  // ChatAuthService e exportado para a tela de integracoes reaproveitar a
  // mesma sessao do chat, sem exigir um segundo login.
  exports: [ChatAccountService, InviteService, ChatAuthService],
})
export class ChatModule {}
