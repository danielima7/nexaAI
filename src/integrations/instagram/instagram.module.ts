import { Module } from '@nestjs/common';
import { InstagramService } from './instagram.service';
import { InstagramTools } from './instagram.tools';
import { InstagramController } from './instagram.controller';

/**
 * Modulo isolado da integracao com o Instagram (metricas e perfil).
 * Mesmo padrao das demais: registra ferramentas no ToolRegistry global.
 * O controller expoe o fluxo OAuth por organizacao.
 */
@Module({
  controllers: [InstagramController],
  providers: [InstagramService, InstagramTools],
})
export class InstagramModule {}
