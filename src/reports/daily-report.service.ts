import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ConversationMemoryService } from '../ai/conversation-memory.service';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service';
import { ReportScheduleService } from './report-schedule.service';
import { NotificacaoService } from './notificacao.service';

/** Canais por onde o resumo pode sair. */
export type CanalResumo = 'email' | 'whatsapp';

/** O minimo que o servico precisa saber para entregar um resumo. */
export interface DestinoResumo {
  organizationId: string;
  channel: string;
  focus?: string | null;
  emailTo?: string | null;
}

/**
 * Resumo diario proativo: o Kyrius manda o panorama do negocio sozinho, no
 * horario que a organizacao escolheu, sem ninguem perguntar nada.
 *
 * O texto NAO e montado por codigo. Mandamos uma instrucao para a propria IA,
 * com as ferramentas da organizacao disponiveis — assim o resumo se adapta ao
 * que cada cliente conectou (quem so tem Asaas ouve sobre cobrancas; quem tem
 * Instagram ouve sobre seguidores) sem um `if` por integracao.
 *
 * ENTREGA PLUGAVEL. A geracao e agnostica de canal; so o transporte muda:
 *  - `email` (padrao): usa a conta Google que a organizacao ja autorizou para
 *    as planilhas. Nao depende de aprovacao de plataforma nenhuma.
 *  - `whatsapp`: exige numero ativo e, fora da janela de 24h, template
 *    aprovado pela Meta. Indisponivel enquanto a conta estiver banida.
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
    private readonly notificacao: NotificacaoService,
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
      if (this.agenda.mesmoDiaLocal(schedule.lastSentAt, agora.dia)) continue;

      const minutosAlvo = schedule.hour * 60 + schedule.minute;
      const atraso = minutosAgora - minutosAlvo;
      if (atraso < 0 || atraso > DailyReportService.ATRASO_MAXIMO_MIN) continue;

      try {
        await this.enviarPara(schedule);
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
   * Gera e entrega o resumo de uma organizacao. Publico para permitir disparo
   * manual (util para testar sem esperar o horario).
   */
  async enviarPara(destino: DestinoResumo): Promise<string> {
    const canal: CanalResumo =
      destino.channel === 'whatsapp' ? 'whatsapp' : 'email';

    return canal === 'whatsapp'
      ? this.enviarPorWhatsapp(destino)
      : this.enviarPorEmail(destino);
  }

  // ---------- Entrega por e-mail (padrao) ----------

  private async enviarPorEmail(destino: DestinoResumo): Promise<string> {
    const para =
      destino.emailTo?.trim() ||
      (await this.notificacao.emailDaOrganizacao(destino.organizationId));
    if (!para) {
      throw new Error(
        'Nenhum e-mail de destino: a organizacao nao tem conta de acesso nem e-mail configurado.',
      );
    }

    const texto = await this.gerar(destino, `email:${para}`);
    const hoje = new Date().toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });

    await this.notificacao.enviarEmail(
      destino.organizationId,
      `Kyrius — resumo de ${hoje}`,
      texto,
      para,
    );

    return texto;
  }

  // ---------- Entrega por WhatsApp ----------

  private async enviarPorWhatsapp(destino: DestinoResumo): Promise<string> {
    const usuario = await this.destinatarioWhatsapp(destino.organizationId);
    if (!usuario) {
      throw new Error(
        'Nenhum usuario com numero de WhatsApp encontrado para esta organizacao.',
      );
    }

    const texto = await this.gerar(destino, usuario.whatsappPhone, usuario.id);
    await this.whatsapp.sendTextMessage(usuario.whatsappPhone, texto);

    // So o WhatsApp guarda o resumo no historico: ali existe continuidade de
    // conversa, e o dono pode responder "me detalha o item 2". No e-mail nao ha
    // conversa para continuar.
    await this.memory.append(
      usuario.whatsappPhone,
      { role: 'assistant', content: texto },
      { organizationId: destino.organizationId, userId: usuario.id },
    );

    this.logger.log(
      `Resumo diario enviado por WhatsApp (organizacao ${destino.organizationId}).`,
    );
    return texto;
  }

  /**
   * Primeiro usuario da organizacao com numero real de WhatsApp.
   * `whatsappPhone` e opcional desde que o Chat Web ganhou login proprio.
   */
  private async destinatarioWhatsapp(
    organizationId: string,
  ): Promise<{ id: string; whatsappPhone: string } | undefined> {
    const usuarios = await this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    const comNumero = usuarios.find(
      (u) => !!u.whatsappPhone && /^\d{10,15}$/.test(u.whatsappPhone),
    );

    return comNumero?.whatsappPhone
      ? { id: comNumero.id, whatsappPhone: comNumero.whatsappPhone }
      : undefined;
  }

  // ---------- Geracao (agnostica de canal) ----------

  /** Pede o resumo a IA, com as ferramentas da organizacao disponiveis. */
  private async gerar(
    destino: DestinoResumo,
    contact: string,
    userId?: string,
  ): Promise<string> {
    const instrucao = [
      'Monte o resumo diario do negocio para o dono.',
      'Consulte as integracoes conectadas e traga o que mudou: dinheiro que entrou',
      'nas ultimas 24h, cobrancas que vencem hoje, clientes inadimplentes,',
      'compromissos da agenda e desempenho das redes sociais.',
      'Use apenas as ferramentas cujas integracoes estejam conectadas — se uma',
      'responder que nao esta conectada, ignore em silencio e siga com o resto,',
      'sem mencionar o que faltou.',
      'Comece com uma saudacao curta. Seja objetivo: numeros primeiro, listas',
      'curtas, sem enrolacao. Se nao houver nada relevante, diga isso em uma linha.',
      destino.focus ? `O dono pediu atencao especial a: ${destino.focus}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return this.ai.generateReply([{ role: 'user', content: instrucao }], {
      contact,
      organizationId: destino.organizationId,
      userId,
      audience: 'owner',
    });
  }
}
