import { Module } from '@nestjs/common';
import { InstagramService } from './instagram.service';
import { InstagramTools } from './instagram.tools';
import { InstagramController } from './instagram.controller';
import { InstagramDmService } from './instagram-dm.service';
import { AiModule } from '../../ai/ai.module';

/**
 * Modulo isolado da integracao com o Instagram.
 *
 * Duas capacidades bem diferentes convivem aqui:
 *  - METRICAS (ferramentas `instagram_*`), usadas pelo dono da empresa;
 *  - ATENDIMENTO POR DIRECT, onde quem fala e um cliente DELE — e por isso
 *    roda com `audience: 'public'`, sem nenhuma ferramenta.
 *
 * Importa o AiModule porque o atendimento gera respostas com a IA.
 */
@Module({
  imports: [AiModule],
  controllers: [InstagramController],
  providers: [InstagramService, InstagramTools, InstagramDmService],
  // Exportado para a coleta diaria de metricas: o Instagram nao guarda
  // historico, entao alguem precisa medir seguidores e alcance todo dia.
  exports: [InstagramService],
})
export class InstagramModule {}
