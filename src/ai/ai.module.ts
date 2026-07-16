import { Module } from '@nestjs/common';
import { AiService } from './ai.service';

/**
 * Modulo de IA do Nexa. Exporta o AiService para ser usado por outros
 * modulos (ex: WhatsApp, e futuramente Chat Web).
 */
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
