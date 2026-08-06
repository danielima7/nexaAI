import { Module } from '@nestjs/common';
import { HubspotService } from './hubspot.service';
import { HubspotTools } from './hubspot.tools';

/**
 * Modulo isolado da integracao com o HubSpot (CRM).
 *
 * Segue a filosofia do Katalli: cada integracao e um modulo independente.
 * Ao ser carregado, registra suas ferramentas no ToolRegistry (global),
 * dando novas capacidades a IA sem alterar o modulo de IA.
 */
@Module({
  providers: [HubspotService, HubspotTools],
})
export class HubspotModule {}
