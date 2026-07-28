import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ConversationMemoryService } from '../ai/conversation-memory.service';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service';
import { ReportScheduleService } from './report-schedule.service';

/**
 * Resumo diario proativo: o Kyrius manda o panorama do negocio sozinho, no
 * horario que a organizacao escolheu, sem ninguem perguntar nada.
 *
 * O texto NAO e montado por codigo. Mandamos uma instrucao para a propria IA,
 * com as ferramentas da organizacao disponiveis — assim o resumo se adapta ao
 * que cada cliente conectou (quem so tem Asaas ouve sobre cobrancas; quem tem
 * Instagram ouve sobre seguidores) sem um `if` por integracao.
 *
 * ⚠️ LIMITE DA META (nao resolvido aqui): fora da janela de 24h desde a ultima
 * mensagem do usuario, a Meta so aceita *template aprovado* — texto livre e
 * recusado. Em dev, e para quem falou com o bot nas ultimas 24h, funciona.
 * Para producao isto vai exigir um template de mensagem aprovado.
 */
@Injectable()
export class DailyReportService {
  private readonly logger = new Logger(DailyReportService.name);

  /**
   * Tolerancia, em minutos, para enviar depois do horario marcado. Cobre
   * reinicios e quedas curtas: o resumo sai assim que a aplicacao volta.
   * Passou disso, pulamos o dia — resumo do dia anterior as 23h nao ajuda.
   */
  private static readonly ATRASO_MAXIMO_MIN = 120;

  /** Evita dois envios simultaneos se um ciclo demorar mais que o intervalo. */
  private executando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: ReportScheduleService,
    private readonly ai: AiService,
    private readonly memory: ConversationMemoryService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async verificarEnvios(): Promise<void> {
    if (this.executando) return;
    this.executando = true;
    try {
      await this.processarPendentes();
    } catch (e: any) {
      this.logger.error(`Falha no ciclo de resumos: ${e?.message ?? e}`);
    } finally {
      this.executando = false;
    }
  }

  /** Envia o resumo para toda organizacao cujo horario ja passou hoje. */
  private async processarPendentes(): Promise<void> {
    const agora = this.agenda.agoraLocal();
    const minutosAgora = agora.hora * 60 + agora.minuto;

    for (const schedule of await this.agenda.listarAtivas()) {
      // Ja enviamos hoje?
      if (this.agenda.mesmoDiaLocal(schedule.lastSentAt, agora.dia)) continue;

      const minutosAlvo = schedule.hour * 60 + schedule.minute;
      const atraso = minutosAgora - minutosAlvo;
      if (atraso < 0 || atraso > DailyReportService.ATRASO_MAXIMO_MIN) continue;

      try {
        await this.enviarPara(schedule.organizationId, schedule.focus);
        await this.agenda.registrarEnvio(schedule.organizationId);
      } catch (e: any) {
        // Falha de uma organizacao nao pode derrubar as outras. Nao marcamos
        // o envio, entao a proxima passagem tenta de novo dentro da janela.
        this.logger.error(
          `Resumo diario falhou para a organizacao ${schedule.organizationId}: ${e?.message ?? e}`,
        );
      }
    }
  }

  /**
   * Gera e envia o resumo de uma organizacao. Publico para permitir disparo
   * manual (util para testar sem esperar o horario).
   */
  async enviarPara(organizationId: string, focus?: string | null): Promise<string> {
    const destinatario = await this.destinatario(organizationId);
    if (!destinatario) {
      throw new Error(
        'Nenhum usuario com numero de WhatsApp encontrado para esta organizacao.',
      );
    }

    const texto = await this.gerar(organizationId, destinatario, focus);
    await this.whatsapp.sendTextMessage(destinatario.whatsappPhone, texto);

    // Guarda no historico para o dono poder responder ("me detalha o item 2")
    // e a IA ter contexto. So a resposta entra — a instrucao interna nao.
    await this.memory.append(
      destinatario.whatsappPhone,
      { role: 'assistant', content: texto },
      { organizationId, userId: destinatario.id },
    );

    this.logger.log(`Resumo diario enviado para a organizacao ${organizationId}.`);
    return texto;
  }

  /**
   * Primeiro usuario da organizacao com numero real de WhatsApp.
   * Sessoes do chat web (`web:*`) e usuarios tecnicos nao recebem resumo.
   */
  private async destinatario(organizationId: string) {
    const usuarios = await this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return usuarios.find((u) => /^\d{10,15}$/.test(u.whatsappPhone));
  }

  /** Pede o resumo a IA, com as ferramentas da organizacao disponiveis. */
  private async gerar(
    organizationId: string,
    destinatario: { id: string; whatsappPhone: string },
    focus?: string | null,
  ): Promise<string> {
    const instrucao = [
      'Monte o resumo diario do negocio para o dono, que vai ler no WhatsApp.',
      'Consulte as integracoes conectadas e traga o que mudou: dinheiro que entrou',
      'nas ultimas 24h, cobrancas que vencem hoje, clientes inadimplentes,',
      'compromissos da agenda e desempenho das redes sociais.',
      'Use apenas as ferramentas cujas integracoes estejam conectadas — se uma',
      'responder que nao esta conectada, ignore em silencio e siga com o resto,',
      'sem mencionar o que faltou.',
      'Comece com uma saudacao curta. Seja objetivo: numeros primeiro, listas',
      'curtas, sem enrolacao. Se nao houver nada relevante, diga isso em uma linha.',
      focus ? `O dono pediu atencao especial a: ${focus}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return this.ai.generateReply([{ role: 'user', content: instrucao }], {
      contact: destinatario.whatsappPhone,
      organizationId,
      userId: destinatario.id,
      audience: 'owner',
    });
  }
}
