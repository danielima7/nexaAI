import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { AiModule } from '../../ai/ai.module';
import { ConsentimentoModule } from '../../whatsapp-envio/consentimento.module';

/**
 * Modulo isolado da integracao com o WhatsApp Business Platform.
 *
 * Segue a filosofia do Katalli: cada integracao e um modulo independente,
 * podendo ser adicionada/removida sem afetar o restante da arquitetura.
 */
@Module({
  imports: [AiModule, ConsentimentoModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  // Exportado para o resumo diario poder enviar mensagens proativas.
  exports: [WhatsappService],
})
export class WhatsappModule {}
