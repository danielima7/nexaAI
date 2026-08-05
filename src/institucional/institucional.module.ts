import { Module } from '@nestjs/common';
import { InstitucionalController } from './institucional.controller';

/** Paginas institucionais: privacidade, termos, seguranca e acessibilidade. */
@Module({
  controllers: [InstitucionalController],
})
export class InstitucionalModule {}
