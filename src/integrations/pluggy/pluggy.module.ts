import { Module } from '@nestjs/common';
import { PluggyService } from './pluggy.service';
import { PluggyTools } from './pluggy.tools';
import { PluggyController } from './pluggy.controller';

/**
 * Modulo isolado da integracao com o Pluggy (Open Finance / bancos).
 * Expoe o fluxo do widget de conexao (PluggyController) e as ferramentas.
 */
@Module({
  controllers: [PluggyController],
  providers: [PluggyService, PluggyTools],
})
export class PluggyModule {}
