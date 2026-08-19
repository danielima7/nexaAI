import { Module } from '@nestjs/common';
import { LinkedinService } from './linkedin.service';
import { LinkedinTools } from './linkedin.tools';
import { LinkedinController } from './linkedin.controller';

/**
 * Modulo isolado da integracao com o LinkedIn.
 *
 * Expoe o fluxo OAuth e registra a ferramenta de publicacao. Segue a mesma
 * forma dos outros: cada integracao e independente e ganha capacidade para a
 * IA sem que o modulo de IA precise conhece-la.
 */
@Module({
  controllers: [LinkedinController],
  providers: [LinkedinService, LinkedinTools],
  // Exportado para o validador de conexoes conseguir testar a credencial —
  // o token vence em ~60 dias e sem verificacao o cliente so descobre quando
  // um post falha.
  exports: [LinkedinService],
})
export class LinkedinModule {}
