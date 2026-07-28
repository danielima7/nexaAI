import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsappModule } from './integrations/whatsapp/whatsapp.module';
import { HubspotModule } from './integrations/hubspot/hubspot.module';
import { StripeModule } from './integrations/stripe/stripe.module';
import { MercadopagoModule } from './integrations/mercadopago/mercadopago.module';
import { AsaasModule } from './integrations/asaas/asaas.module';
import { GoogleModule } from './integrations/google/google.module';
import { PagarmeModule } from './integrations/pagarme/pagarme.module';
import { PluggyModule } from './integrations/pluggy/pluggy.module';
import { InstagramModule } from './integrations/instagram/instagram.module';
import { ChatModule } from './chat/chat.module';
import { AiModule } from './ai/ai.module';
import { ToolsModule } from './tools/tools.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { ConnectionsModule } from './connections/connections.module';

@Module({
  imports: [
    // Carrega as variaveis do .env e as torna disponiveis em toda a aplicacao
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Banco de dados (Prisma / PostgreSQL) — global
    PrismaModule,
    // Multi-tenant (organizacoes e usuarios) — global
    TenantModule,
    // Conexoes/credenciais por organizacao — global
    ConnectionsModule,
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
    GoogleModule,
    PagarmeModule,
    PluggyModule,
    InstagramModule,
    ChatModule,
  ],
})
export class AppModule {}
