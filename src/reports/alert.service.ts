import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { NotificacaoService } from './notificacao.service';

/**
 * Alertas: avisam o dono quando algo muda, sem ele perguntar.
 *
 * A DECISAO CENTRAL DE CUSTO: a verificacao NAO passa pela IA. Executamos a
 * ferramenta, comparamos o texto com o resultado anterior, e so chamamos a IA
 * para redigir o aviso quando ha diferenca.
 *
 * Se cada verificacao usasse a IA, um unico alerta de hora em hora custaria
 * ~R$ 57/mes, e de 15 em 15 minutos ~R$ 230 — mais que a margem do cliente.
 * Do jeito atual, um alerta que nunca dispara custa zero em IA.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  /** Evita ciclos sobrepostos se uma verificacao demorar. */
  private executando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly tools: ToolRegistryService,
    private readonly notificacao: NotificacaoService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async verificar(): Promise<void> {
    if (this.executando) return;
    this.executando = true;
    try {
      await this.processarPendentes();
    } catch (e: any) {
      this.logger.error(`Falha no ciclo de alertas: ${e?.message ?? e}`);
    } finally {
      this.executando = false;
    }
  }

  /** Verifica os alertas cujo intervalo ja venceu. */
  private async processarPendentes(): Promise<void> {
    const alertas = await this.prisma.alert.findMany({ where: { ativo: true } });
    const agora = Date.now();

    for (const alerta of alertas) {
      const proximo =
        (alerta.lastCheckedAt?.getTime() ?? 0) + alerta.frequenciaMin * 60_000;
      if (agora < proximo) continue;

      try {
        await this.verificarUm(alerta);
      } catch (e: any) {
        // Um alerta quebrado nao pode impedir os outros de rodar.
        this.logger.error(
          `Alerta ${alerta.id} falhou: ${e?.message ?? e}`,
        );
      }
    }
  }

  /**
   * Executa a ferramenta do alerta e avisa se o resultado mudou.
   * Publico para permitir disparo manual em teste.
   */
  async verificarUm(alerta: {
    id: string;
    organizationId: string;
    descricao: string;
    ferramenta: string;
    argumentos: any;
    ultimoResultado: string | null;
  }): Promise<{ mudou: boolean; resultado: string }> {
    const organizacao = await this.prisma.organization.findUnique({
      where: { id: alerta.organizationId },
    });

    const resultado = await this.tools.execute(
      alerta.ferramenta,
      alerta.argumentos ?? {},
      {
        organizationId: alerta.organizationId,
        audience: 'owner',
        demo: organizacao?.demo ?? false,
      },
    );

    const mudou =
      alerta.ultimoResultado !== null &&
      this.normalizar(alerta.ultimoResultado) !== this.normalizar(resultado);

    await this.prisma.alert.update({
      where: { id: alerta.id },
      data: {
        ultimoResultado: resultado,
        lastCheckedAt: new Date(),
        ...(mudou ? { lastFiredAt: new Date() } : {}),
      },
    });

    // Primeira verificacao apenas grava a linha de base: sem ela, todo alerta
    // dispararia no momento em que fosse criado.
    if (alerta.ultimoResultado === null) {
      this.logger.log(`Alerta ${alerta.id}: linha de base registrada.`);
      return { mudou: false, resultado };
    }

    if (mudou) await this.avisar(alerta, resultado);
    return { mudou, resultado };
  }

  /**
   * Normaliza antes de comparar.
   *
   * As ferramentas formatam valores e datas, entao diferencas de espaco em
   * branco nao significam mudanca real. Sem isso, alertas disparariam a toa.
   */
  private normalizar(texto: string): string {
    return texto.replace(/\s+/g, ' ').trim();
  }

  /** Redige e envia o aviso. Unico ponto do fluxo que usa a IA. */
  private async avisar(
    alerta: { organizationId: string; descricao: string },
    resultado: string,
  ): Promise<void> {
    const instrucao = [
      `O usuario pediu para ser avisado sobre: "${alerta.descricao}".`,
      'Algo mudou desde a ultima verificacao. Abaixo esta a situacao ATUAL.',
      'Escreva um aviso curto (2 a 4 linhas), direto, dizendo o que mudou e o que',
      'merece atencao. Nao invente numeros: use apenas o que esta abaixo.',
      'Nao use ferramentas — apenas escreva o aviso.',
      '',
      'Situacao atual:',
      resultado,
    ].join('\n');

    const texto = await this.ai.generateReply(
      [{ role: 'user', content: instrucao }],
      {
        organizationId: alerta.organizationId,
        // Sem ferramentas: aqui a IA so redige. Isso tambem evita que ela
        // saia consultando integracoes e encarecendo o aviso.
        audience: 'public',
        instrucoesPublicas:
          'Voce esta redigindo um aviso interno para o dono da empresa.',
      },
    );

    await this.notificacao.enviarEmail(
      alerta.organizationId,
      `Kyrius — alerta: ${alerta.descricao}`,
      texto,
    );

    this.logger.log(
      `Alerta disparado para a organizacao ${alerta.organizationId}: ${alerta.descricao}`,
    );
  }
}
