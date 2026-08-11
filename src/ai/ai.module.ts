import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ModelRouterService } from './model-router.service';
import { AiUsageService } from './ai-usage.service';
import { CustoIaService } from './custo-ia.service';
import { LimiteUsoService } from './limite-uso.service';
import { SaudeIaService } from './saude-ia.service';

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
    LimiteUsoService,
    SaudeIaService,
  ],
  // LimiteUsoService e exportado porque o chat precisa perguntar "pode?" antes
  // de chamar a IA. AiUsageService sai junto por causa dos scripts de custo.
  // ModelRouterService segue interno: quem chama escolhe a ROTA, nunca o modelo.
  exports: [
    AiService,
    ConversationMemoryService,
    AiUsageService,
    CustoIaService,
    LimiteUsoService,
    // Exportado para o ReportsModule se inscrever no aviso de queda. A direcao
    // e essa de proposito: quem chama a API detecta, quem tem canal de e-mail
    // avisa — o contrario criaria ciclo entre os modulos.
    SaudeIaService,
  ],
})
export class AiModule {}
