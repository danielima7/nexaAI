import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ModelRouterService } from './model-router.service';
import { AiUsageService } from './ai-usage.service';
import { CustoIaService } from './custo-ia.service';

/**
 * Modulo de IA do Katalli. Exporta o AiService e o ConversationMemoryService
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
    CustoIaService,
  ],
  // AiUsageService e exportado porque o chat precisa consultar a cota antes de
  // chamar a IA. ModelRouterService segue interno: quem chama escolhe a ROTA,
  // nunca o modelo.
  exports: [AiService, ConversationMemoryService, AiUsageService, CustoIaService],
})
export class AiModule {}
