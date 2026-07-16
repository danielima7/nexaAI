import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsappModule } from './integrations/whatsapp/whatsapp.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    // Carrega as variaveis do .env e as torna disponiveis em toda a aplicacao
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Modulo de IA (Claude)
    AiModule,
    // Modulo isolado da integracao com o WhatsApp
    WhatsappModule,
  ],
})
export class AppModule {}
