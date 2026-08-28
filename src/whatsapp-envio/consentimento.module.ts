import { Module } from '@nestjs/common';
import { ConsentimentoService } from './consentimento.service';

/**
 * Modulo minimo so com o registro de consentimento.
 *
 * Existe separado do WhatsappEnvioModule por uma razao estrutural: o webhook
 * (WhatsappModule) precisa avisar que o contato escreveu, e o envio precisa
 * do WhatsappModule para falar com a Graph API. Um modulo unico fecharia o
 * ciclo. Este corta o no sem `forwardRef`, que so esconderia o problema.
 */
@Module({
  providers: [ConsentimentoService],
  exports: [ConsentimentoService],
})
export class ConsentimentoModule {}
