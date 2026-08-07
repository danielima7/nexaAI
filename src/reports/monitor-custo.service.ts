import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CustoIaService } from '../ai/custo-ia.service';
import { NotificacaoService } from './notificacao.service';

/**
 * Vigia o gasto com IA e avisa quando o dia passa do teto.
 *
 * Por que existe: `/criar-conta` e publico e as contas nascem sem limite de
 * mensagens. Nao ha nada, hoje, que impeca alguem de descobrir a URL e
 * consumir credito ate acabar — e sem este vigia a descoberta viria pela
 * fatura da Anthropic, semanas depois.
 *
 * O alerta nao interrompe nada e nao bloqueia ninguem: ele so encurta o tempo
 * entre "comecou a sangrar" e "eu fiquei sabendo". Quem decide desligar a
 * rota (KATALLI_AUTOCADASTRO=false) ou impor teto continua sendo voce.
 */
@Injectable()
export class MonitorCustoService {
  private readonly logger = new Logger(MonitorCustoService.name);

  /** Teto padrao do dia, em reais, quando nao configurado. */
  private static readonly TETO_PADRAO = 50;

  /**
   * Dia em que o alerta ja foi enviado (formato AAAA-MM-DD).
   *
   * Em memoria de proposito: se o processo reiniciar e o gasto seguir acima
   * do teto, avisar de novo e o comportamento desejado — reinicio nao e
   * motivo para silenciar um alerta que continua valendo.
   */
  private avisadoEm?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly custos: CustoIaService,
    private readonly notificacao: NotificacaoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Teto diario em reais. */
  get teto(): number {
    const bruto = Number(
      this.config.get<string>('KATALLI_ALERTA_CUSTO_DIARIO'),
    );
    return Number.isFinite(bruto) && bruto > 0
      ? bruto
      : MonitorCustoService.TETO_PADRAO;
  }

  /** Organizacao que recebe o aviso — a sua, nao a de um cliente. */
  private get destino(): string | undefined {
    return this.config.get<string>('OWNER_ORGANIZATION_ID')?.trim() || undefined;
  }

  /**
   * A cada 15 minutos. Frequencia escolhida pelo prejuizo evitavel: de hora em
   * hora, um script rodando solto acumularia muito antes do primeiro aviso. A
   * verificacao e uma consulta agregada — custo proprio irrelevante.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async verificar(): Promise<void> {
    try {
      await this.checar();
    } catch (erro: unknown) {
      // Telemetria nunca derruba o processo principal.
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao verificar custo de IA: ${detalhe}`);
    }
  }

  /** Exposto separado do @Cron para poder ser testado sem agendador. */
  async checar(): Promise<void> {
    const hoje = new Date().toISOString().slice(0, 10);
    if (this.avisadoEm === hoje) return; // um aviso por dia ja basta

    const relatorio = await this.custos.relatorioDeHoje();
    if (relatorio.brl < this.teto) return;

    this.logger.warn(
      `Gasto de IA hoje: R$ ${relatorio.brl.toFixed(2)} — acima do teto de R$ ${this.teto.toFixed(2)}.`,
    );

    // Marca ANTES de enviar: se o envio falhar, o log acima ja registrou o
    // essencial, e insistir a cada 30 min encheria a caixa de entrada.
    this.avisadoEm = hoje;

    const destino = this.destino;
    if (!destino) {
      this.logger.error(
        'OWNER_ORGANIZATION_ID nao configurado — o alerta de custo ficou so no log.',
      );
      return;
    }

    try {
      await this.notificacao.enviarEmail(
        destino,
        `[Katalli] Gasto de IA passou de R$ ${this.teto.toFixed(2)} hoje`,
        await this.montarTexto(relatorio),
      );
      this.logger.log('Alerta de custo enviado.');
    } catch (erro: unknown) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Nao foi possivel enviar o alerta de custo: ${detalhe}`);
    }
  }

  /** Texto do aviso: o suficiente para decidir sem abrir o banco. */
  private async montarTexto(
    r: Awaited<ReturnType<CustoIaService['relatorioDeHoje']>>,
  ): Promise<string> {
    const linhas: string[] = [
      `O gasto com IA hoje chegou a R$ ${r.brl.toFixed(2)} (US$ ${r.usd.toFixed(2)}),`,
      `acima do teto configurado de R$ ${this.teto.toFixed(2)}.`,
      '',
      `Interacoes no dia: ${r.interacoes}`,
      '',
      'POR MODELO',
    ];

    for (const m of r.porModelo) {
      linhas.push(`  ${m.modelo}: R$ ${m.brl.toFixed(2)} (${m.interacoes} interacoes)`);
    }

    // Nome da organizacao, nao o uuid: e o que permite reconhecer na hora se
    // o gasto veio de um cliente de verdade ou de uma conta criada sozinha.
    linhas.push('', 'POR EMPRESA');
    for (const o of r.porOrganizacao.slice(0, 8)) {
      let nome = 'sem organizacao';
      let origem = '';
      if (o.organizationId) {
        const org = await this.prisma.organization
          .findUnique({ where: { id: o.organizationId } })
          .catch(() => null);
        nome = org?.name ?? o.organizationId;
        if (org?.autocadastro) origem = '  [criada pelo proprio visitante]';
      }
      linhas.push(
        `  ${nome}: R$ ${o.brl.toFixed(2)} (${o.interacoes} interacoes)${origem}`,
      );
    }

    linhas.push(
      '',
      'O QUE FAZER SE ISSO NAO FOR ESPERADO',
      '  1. Desligue o cadastro aberto: KATALLI_AUTOCADASTRO=false',
      '  2. Imponha teto nas contas de autocadastro: KATALLI_AUTOCADASTRO_LIMITE=20',
      '  3. Confira o consumo detalhado: npm run custo',
      '',
      'Este aviso e enviado uma vez por dia.',
    );

    return linhas.join('\n');
  }
}
