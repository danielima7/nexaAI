import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { ReportsModule } from './reports/reports.module';
import { HealthController } from './health/health.controller';
import { UploadsModule } from './uploads/uploads.module';
import { SuporteModule } from './suporte/suporte.module';

@Module({
  imports: [
    // Carrega as variaveis do .env e as torna disponiveis em toda a aplicacao
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Agendador (usado pelo resumo diario proativo)
    ScheduleModule.forRoot(),
    // Banco de dados (Prisma / PostgreSQL) — global
    PrismaModule,
    // Multi-tenant (organizacoes e usuarios) — global
    TenantModule,
    // Conexoes/credenciais por organizacao — global
    ConnectionsModule,
    // Canal de suporte humano (link de WhatsApp) — global
    SuporteModule,
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
    // Planilhas enviadas pelo cliente no chat
    UploadsModule,
    // Resumo diario proativo (depende de AiModule + WhatsappModule)
    ReportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
