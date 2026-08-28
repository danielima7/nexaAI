import { Module } from '@nestjs/common';
import { WhatsappModule } from '../integrations/whatsapp/whatsapp.module';
import { ConsentimentoModule } from './consentimento.module';
import { TemplateService } from './template.service';
import { EnvioWhatsappService } from './envio-whatsapp.service';
import { WhatsappEnvioTools } from './whatsapp-envio.tools';

/**
 * Envio ativo pelo WhatsApp: consentimento, templates e as travas de politica.
 *
 * Separado do WhatsappModule de proposito. Aquele modulo e a INTEGRACAO — recebe
 * webhook e fala com a Graph API. Este e a REGRA DE NEGOCIO de quem pode receber
 * o que, e quando. Misturar os dois faria a regra sumir dentro do transporte, e
 * e justamente a regra que evita o banimento da conta do cliente.
 */
@Module({
  imports: [WhatsappModule, ConsentimentoModule],
  providers: [TemplateService, EnvioWhatsappService, WhatsappEnvioTools],
  // Reexporta o MODULO, nao o service: quem prove ConsentimentoService e o
  // ConsentimentoModule, e o Nest recusa exportar um provider que este modulo
  // nao declara. Assim quem importar WhatsappEnvioModule continua enxergando
  // consentimento, templates e envio de uma vez so.
  exports: [ConsentimentoModule, TemplateService, EnvioWhatsappService],
})
export class WhatsappEnvioModule {}
