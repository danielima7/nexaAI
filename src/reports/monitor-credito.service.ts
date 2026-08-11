import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FalhaGlobal, SaudeIaService } from '../ai/saude-ia.service';
import { NotificacaoService } from './notificacao.service';

/**
 * Avisa VOCE, por e-mail, no instante em que a IA para de atender todo mundo.
 *
 * Separado do MonitorCustoService porque as perguntas sao diferentes:
 *
 *  - MonitorCustoService: "alguem esta queimando dinheiro rapido demais hoje?"
 *    Compara o gasto do DIA com um teto. Nao enxerga saldo.
 *  - Este: "o produto esta no ar?" Dispara no primeiro erro que derruba todos
 *    os clientes — saldo zerado ou chave invalida.
 *
 * Saldo que acaba devagar nunca encosta num teto diario, entao nenhum ajuste
 * no monitor de custo cobriria este caso. Foi assim que a conta secou sem
 * ninguem perceber.
 *
 * O e-mail sai pela conta Google, que nao depende da Anthropic — o canal de
 * aviso continua de pe justamente quando a IA cai.
 */
@Injectable()
export class MonitorCreditoService implements OnModuleInit {
  private readonly logger = new Logger(MonitorCreditoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly saude: SaudeIaService,
    private readonly notificacao: NotificacaoService,
  ) {}

  /** Organizacao que recebe o aviso — a sua, nao a de um cliente. */
  private get destino(): string | undefined {
    return this.config.get<string>('OWNER_ORGANIZATION_ID')?.trim() || undefined;
  }

  onModuleInit(): void {
    this.saude.aoFalhar((tipo, detalhe) => this.avisar(tipo, detalhe));

    if (!this.destino) {
      // Dito no boot, e nao na hora da falha: descobrir que o alerta estava
      // mal configurado no momento em que ele deveria disparar e tarde demais.
      this.logger.warn(
        'OWNER_ORGANIZATION_ID nao configurado — quedas da IA ficarao so no log.',
      );
    }
  }

  /** Envia o aviso. Nunca lanca: roda fora do ciclo de vida da requisicao. */
  private async avisar(tipo: FalhaGlobal, detalhe: string): Promise<void> {
    const destino = this.destino;
    if (!destino) return; // ja avisado no boot; o log do SaudeIaService cobre

    try {
      await this.notificacao.enviarEmail(
        destino,
        tipo === 'credito'
          ? '[Katalli] URGENTE: sem credito na Anthropic — o chat esta fora do ar'
          : '[Katalli] URGENTE: chave da Anthropic recusada — o chat esta fora do ar',
        this.montarTexto(tipo, detalhe),
      );
      this.logger.log(`Alerta de indisponibilidade da IA enviado (${tipo}).`);
    } catch (erro: unknown) {
      const d = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Nao foi possivel enviar o alerta de queda da IA: ${d}`);
    }
  }

  /** Texto do aviso: o suficiente para agir sem abrir o codigo. */
  private montarTexto(tipo: FalhaGlobal, detalhe: string): string {
    const causa =
      tipo === 'credito'
        ? [
            'O saldo da conta na Anthropic acabou.',
            '',
            'COMO RESOLVER',
            '  1. Console da Anthropic > Plans & Billing > comprar creditos.',
            '  2. Ative a recarga automatica e o aviso de saldo baixo — e a',
            '     unica protecao que nenhum caminho de codigo consegue burlar.',
          ]
        : [
            'A chave da Anthropic foi recusada (invalida, revogada ou sem',
            'permissao para o modelo configurado).',
            '',
            'COMO RESOLVER',
            '  1. Confira ANTHROPIC_API_KEY no .env do servidor.',
            '  2. Console da Anthropic > API Keys: veja se a chave ainda existe.',
          ];

    return [
      'TODOS os clientes estao recebendo "Tive um problema para processar sua',
      'mensagem agora" no chat. Nenhuma conversa esta funcionando.',
      '',
      ...causa,
      '',
      'ERRO ORIGINAL',
      `  ${detalhe}`,
      '',
      'Este aviso e enviado uma vez por queda: so volta a disparar depois que',
      'a IA responder normalmente e cair de novo.',
    ].join('\n');
  }
}
