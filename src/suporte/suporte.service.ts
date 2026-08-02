import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Canal de suporte humano do Kyrius (WhatsApp).
 *
 * E um link `wa.me`, nao uma integracao: nao passa por API da Meta, nao exige
 * aprovacao e nao envia nada sozinho. Quem escreve e o cliente, quem responde
 * e uma pessoa. Por isso funciona mesmo com a WhatsApp Business Platform
 * indisponivel para nos — a restricao la e sobre automacao, nao sobre duas
 * pessoas conversando.
 *
 * Centralizado porque o mesmo link aparece no chat e no rodape de todo aviso
 * por e-mail; duplicar a leitura da configuracao acabaria com um numero
 * desatualizado em um dos dois.
 */
@Injectable()
export class SuporteService {
  private readonly logger = new Logger(SuporteService.name);

  /** Numero em formato internacional, so digitos. Ausente = suporte oculto. */
  private readonly numero?: string;

  constructor(config: ConfigService) {
    this.numero = SuporteService.normalizar(
      config.get<string>('KYRIUS_SUPORTE_WHATSAPP'),
    );

    if (this.numero) {
      this.logger.log(`Suporte por WhatsApp ativo (${this.numero}).`);
    } else {
      this.logger.warn(
        'KYRIUS_SUPORTE_WHATSAPP nao configurado — o botao de suporte fica oculto.',
      );
    }
  }

  /**
   * Aceita o numero como o usuario escreveria — "+55 (24) 99999-0000" — e
   * devolve so digitos, que e o formato exigido pelo wa.me.
   *
   * Devolve undefined em vez de um numero suspeito: um link quebrado leva o
   * cliente a uma tela de erro do WhatsApp bem na hora em que ele precisa de
   * ajuda, o que e pior do que nao oferecer o canal.
   */
  private static normalizar(bruto?: string): string | undefined {
    const digitos = (bruto ?? '').replace(/\D/g, '');
    if (!digitos) return undefined;

    // 12 = 55 + DDD + 8 digitos (fixo/celular antigo); 13 com o 9 na frente.
    // Faixa deliberadamente larga para nao recusar numero de outro pais.
    if (digitos.length < 10 || digitos.length > 15) {
      new Logger(SuporteService.name).error(
        `KYRIUS_SUPORTE_WHATSAPP tem ${digitos.length} digitos, fora da faixa valida (10-15). ` +
          'Use o formato internacional, ex: 5524999990000. Suporte desativado.',
      );
      return undefined;
    }

    return digitos;
  }

  /** Ha um numero valido configurado? */
  get ativo(): boolean {
    return this.numero !== undefined;
  }

  /**
   * Link do WhatsApp, ou undefined se nao houver numero.
   * @param mensagem texto ja preenchido na conversa — poupa o cliente de
   *   explicar de onde veio, e nos diz de qual tela ele saiu.
   */
  link(mensagem?: string): string | undefined {
    if (!this.numero) return undefined;

    const base = `https://wa.me/${this.numero}`;
    return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
  }

  /**
   * Rodape para avisos por e-mail (resumo diario, alertas).
   *
   * Texto puro porque e assim que os avisos sao enviados hoje; a maioria dos
   * clientes de e-mail transforma a URL em link sozinha. Devolve string vazia
   * quando nao ha suporte configurado, entao quem chama pode sempre concatenar.
   */
  rodapeEmail(): string {
    const url = this.link('Ola! Preciso de ajuda com o Kyrius.');
    if (!url) return '';

    return `\n\n---\nPrecisa de ajuda? Fale conosco no WhatsApp: ${url}`;
  }
}
