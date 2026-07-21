import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Modulo global do Prisma — disponibiliza o PrismaService para toda a app
 * (memoria de conversa, logs de operacao, futuras entidades) sem precisar
 * importar este modulo em cada lugar.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
