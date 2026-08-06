import { Global, Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { SystemTools } from './system-tools';

/**
 * Modulo global de ferramentas.
 *
 * E @Global para que qualquer modulo de integracao possa injetar o
 * ToolRegistryService e registrar suas ferramentas sem importar este modulo.
 * Tambem registra as ferramentas de sistema do proprio Katalli (SystemTools).
 */
@Global()
@Module({
  providers: [ToolRegistryService, SystemTools],
  exports: [ToolRegistryService],
})
export class ToolsModule {}
