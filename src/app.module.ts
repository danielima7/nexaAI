import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsappModule } from './integrations/whatsapp/whatsapp.module';
import { HubspotModule } from './integrations/hubspot/hubspot.module';
import { StripeModule } from './integrations/stripe/stripe.module';
import { MercadopagoModule } from './integrations/mercadopago/mercadopago.module';
import { AsaasModule } from './integrations/asaas/asaas.module';
import { AiModule } from './ai/ai.module';
import { ToolsModule } from './tools/tools.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // Carrega as variaveis do .env e as torna disponiveis em toda a aplicacao
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Banco de dados (Prisma / PostgreSQL) — global
    PrismaModule,
    // Registro global de ferramentas (Tools) para a IA
    ToolsModule,
    // Modulo de IA (Claude)
    AiModule,
    // Integracoes (cada uma e um modulo independente)
    WhatsappModule,
    HubspotModule,
    StripeModule,
    MercadopagoModule,
    AsaasModule,
  ],
})
export class AppModule {}
