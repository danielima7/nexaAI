import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ModelRouterService } from './model-router.service';
import { AiUsageService } from './ai-usage.service';

/**
 * Modulo de IA do Kyrius. Exporta o AiService e o ConversationMemoryService
 * para serem usados por outros modulos (ex: WhatsApp, e futuramente Chat Web).
 *
 * ModelRouterService e AiUsageService ficam internos: quem chama a IA escolhe
 * a ROTA, nao o modelo. Deixar o modelo aberto para os chamadores espalharia a
 * decisao de custo por todo o codigo e tornaria impossivel auditar.
 */
@Module({
  providers: [
    AiService,
    ConversationMemoryService,
    ModelRouterService,
    AiUsageService,
  ],
  exports: [AiService, ConversationMemoryService],
})
export class AiModule {}
