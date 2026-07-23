import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { AiModule } from '../ai/ai.module';

/**
 * Modulo do Chat Web. Reaproveita o AiModule (IA + memoria) e o TenantService
 * global. Serve a pagina do chat e o endpoint de mensagens.
 */
@Module({
  imports: [AiModule],
  controllers: [ChatController],
})
export class ChatModule {}
