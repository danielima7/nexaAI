import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { AiModule } from '../../ai/ai.module';

/**
 * Modulo isolado da integracao com o WhatsApp Business Platform.
 *
 * Segue a filosofia do Kyrius: cada integracao e um modulo independente,
 * podendo ser adicionada/removida sem afetar o restante da arquitetura.
 */
@Module({
  imports: [AiModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
