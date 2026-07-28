import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Momento atual no fuso de Sao Paulo, decomposto. */
export interface AgoraLocal {
  hora: number;
  minuto: number;
  /** Data no formato AAAA-MM-DD, usada para saber se ja enviamos hoje. */
  dia: string;
}

/**
 * Preferencias de resumo diario por organizacao (ativar, horario, foco).
 *
 * O horario e sempre interpretado no fuso America/Sao_Paulo: o dono pensa em
 * "8 da manha", nao em UTC. Guardar hora/minuto separados (em vez de um
 * DateTime) evita a classe inteira de bugs de horario de verao.
 */
@Injectable()
export class ReportScheduleService {
  private readonly logger = new Logger(ReportScheduleService.name);

  private static readonly FUSO = 'America/Sao_Paulo';

  constructor(private readonly prisma: PrismaService) {}

  /** Hora, minuto e dia correntes no fuso de Sao Paulo. */
  agoraLocal(): AgoraLocal {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: ReportScheduleService.FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const campo = (tipo: string) =>
      partes.find((p) => p.type === tipo)?.value ?? '0';

    return {
      hora: Number(campo('hour')),
      minuto: Number(campo('minute')),
      dia: `${campo('year')}-${campo('month')}-${campo('day')}`,
    };
  }

  /** O timestamp informado cai no dia local indicado? */
  mesmoDiaLocal(quando: Date | null | undefined, dia: string): boolean {
    if (!quando) return false;
    const formatado = new Intl.DateTimeFormat('en-CA', {
      timeZone: ReportScheduleService.FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(quando);
    return formatado === dia;
  }

  /** Preferencia da organizacao (null se nunca configurada). */
  async get(organizationId: string) {
    return this.prisma.reportSchedule.findUnique({
      where: { organizationId },
    });
  }

  /** Todas as preferencias ativas — usado pelo agendador. */
  async listarAtivas() {
    return this.prisma.reportSchedule.findMany({ where: { enabled: true } });
  }

  /** Cria ou atualiza a preferencia da organizacao. */
  async set(
    organizationId: string,
    dados: {
      enabled?: boolean;
      hour?: number;
      minute?: number;
      focus?: string | null;
    },
  ) {
    return this.prisma.reportSchedule.upsert({
      where: { organizationId },
      create: { organizationId, ...dados },
      update: dados,
    });
  }

  /** Marca o envio de hoje como concluido. */
  async registrarEnvio(organizationId: string): Promise<void> {
    await this.prisma.reportSchedule.update({
      where: { organizationId },
      data: { lastSentAt: new Date() },
    });
  }

  /**
   * Converte "8", "08:00" ou "8h30" em hora/minuto.
   * Retorna `undefined` se nao conseguir interpretar — quem chama decide.
   */
  interpretarHorario(bruto?: string): { hour: number; minute: number } | undefined {
    if (!bruto) return undefined;
    const m = bruto.trim().match(/^(\d{1,2})\s*(?:[:h]\s*(\d{1,2}))?/i);
    if (!m) return undefined;

    const hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;

    return { hour, minute };
  }

  /** "08:00" a partir dos campos guardados. */
  formatarHorario(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
}
