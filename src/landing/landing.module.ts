import { Module } from '@nestjs/common';
import { LandingController } from './landing.controller';

/** Pagina publica de apresentacao, servida na raiz do dominio. */
@Module({
  controllers: [LandingController],
})
export class LandingModule {}
