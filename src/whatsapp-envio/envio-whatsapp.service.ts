import { Injectable, Logger } from '@nestjs/common';
import { ConsentimentoService } from './consentimento.service';
import { TemplateService } from './template.service';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service';

export interface ResultadoEnvio {
  enviado: boolean;
  motivo: string;
}

/**
 * Envio de mensagem no WhatsApp, com as duas travas da plataforma aplicadas
 * ANTES de qualquer chamada.
 *
 * A ordem das regras nao e nossa, e da politica do WhatsApp:
 *
 *  1. So se pode escrever para quem forneceu o numero E autorizou o contato.
 *  2. Fora da janela de 24h desde a ultima mensagem do contato, so template
 *     aprovado — texto livre e RECUSADO pela API.
 *
 * O que este service faz e tornar as duas verificaveis antes do disparo, em vez
 * de descobrir pelo erro da Meta. A diferenca importa porque a punicao por
 * descumprimento nao e o erro: e o encerramento da conta, documentado como
 * decisao exclusiva deles.
 *
 * ⚠️ NAO EXISTE ENVIO EM LOTE AQUI, e nao deve existir. Uma funcao que percorre
 * lista de telefone e exatamente o que fez a Meta banir os dois numeros deste
 * projeto. Prospeccao fria por WhatsApp e proibida pela politica — para isso
 * existe o modulo de prospeccao por e-mail.
 */
@Injectable()
export class EnvioWhatsappService {
  private readonly logger = new Logger(EnvioWhatsappService.name);

  constructor(
    private readonly consentimento: ConsentimentoService,
    private readonly templates: TemplateService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /**
   * Envia usando um template aprovado.
   *
   * E o caminho para mensagem INICIADA pela empresa: lembrete de vencimento,
   * confirmacao de agendamento, aviso de entrega.
   */
  async enviarTemplate(
    organizationId: string,
    dados: { telefone: string; template: string; valores?: string[]; idioma?: string },
  ): Promise<ResultadoEnvio> {
    const situacao = await this.consentimento.situacao(
      organizationId,
      dados.telefone,
    );
    if (!situacao.autorizado) {
      return { enviado: false, motivo: situacao.motivo! };
    }

    const pronto = await this.templates.paraEnvio(
      organizationId,
      dados.template,
      dados.valores ?? [],
      dados.idioma,
    );
    if (!pronto.ok) return { enviado: false, motivo: pronto.motivo };

    return this.entregar(dados.telefone, pronto.corpo!, `template ${dados.template}`);
  }

  /**
   * Envia texto livre — SO dentro da janela de 24h.
   *
   * Serve para responder alguem que acabou de escrever. Fora da janela, a
   * plataforma recusa, e recusamos antes com uma explicacao util em vez de
   * deixar a API devolver um erro que ninguem entende.
   *
   * A JANELA VEM PRIMEIRO, e nao o consentimento. E o inverso do template, de
   * proposito: aqui quem comecou a conversa foi o contato, e uma mensagem dele
   * nas ultimas 24h ja e o consentimento — exigir cadastro previo deixaria sem
   * resposta justamente quem pediu atendimento.
   */
  async responder(
    organizationId: string,
    telefone: string,
    texto: string,
  ): Promise<ResultadoEnvio> {
    const situacao = await this.consentimento.situacao(organizationId, telefone);

    if (situacao.janelaAberta) {
      return this.entregar(telefone, texto, 'resposta na janela de 24h');
    }

    if (!situacao.autorizado) {
      return { enviado: false, motivo: situacao.motivo! };
    }

    return {
      enviado: false,
      motivo:
        'Faz mais de 24 horas desde a última mensagem desse contato — nessa situação ' +
        'o WhatsApp só aceita template aprovado, não texto livre. Use um template.',
    };
  }

  /** Chamada final. Isolada para o motivo da falha chegar traduzido. */
  private async entregar(
    telefone: string,
    corpo: string,
    contexto: string,
  ): Promise<ResultadoEnvio> {
    const alvo = ConsentimentoService.normalizar(telefone);

    try {
      await this.whatsapp.sendTextMessage(alvo, corpo);
      this.logger.log(`WhatsApp enviado para ${alvo} (${contexto}).`);
      return { enviado: true, motivo: `Mensagem enviada para ${alvo}.` };
    } catch (erro: unknown) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao enviar WhatsApp para ${alvo}: ${detalhe}`);

      // O numero deste projeto esta BANNED hoje. Sem esta traducao, a IA
      // repetiria um erro tecnico da Meta que nao ajuda ninguem a agir.
      if (/banned|not.*registered|invalid.*phone|194|131031/i.test(detalhe)) {
        return {
          enviado: false,
          motivo:
            'A conta de WhatsApp Business não está ativa — o número pode estar banido ' +
            'ou ainda não ter sido aprovado pela Meta. Enquanto isso não for resolvido, ' +
            'nenhum envio funciona.',
        };
      }

      return {
        enviado: false,
        motivo: 'Não consegui enviar agora. Verifique a conexão com o WhatsApp Business.',
      };
    }
  }
}
