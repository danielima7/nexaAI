import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ConversationMemoryService } from './conversation-memory.service';

/**
 * Modulo de IA do Kyrius. Exporta o AiService e o ConversationMemoryService
 * para serem usados por outros modulos (ex: WhatsApp, e futuramente Chat Web).
 */
@Module({
  providers: [AiService, ConversationMemoryService],
  exports: [AiService, ConversationMemoryService],
})
export class AiModule {}
