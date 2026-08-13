import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Um ponto da serie: o dia e o valor medido. */
export interface PontoMetrica {
  dia: Date;
  valor: number;
}

/**
 * Guarda e le as series temporais do cliente.
 *
 * A unidade e o DIA, nunca o instante: o painel responde "quantos seguidores
 * eu tinha no dia 12", e a hora em que o cron rodou nao interessa a ninguem.
 */
@Injectable()
export class MetricaService {
  private readonly logger = new Logger(MetricaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Meia-noite (UTC) do dia corrente no fuso de Sao Paulo.
   *
   * O fuso e explicito pelo mesmo motivo da cota diaria: producao roda em UTC,
   * e a coleta agendada para as 3h da manha no Brasil gravaria no dia seguinte
   * se usasse a data do processo — deslocando o grafico inteiro em um dia.
   */
  static diaDeHoje(agora = new Date()): Date {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(agora);
    // en-CA formata como AAAA-MM-DD, que o Date interpreta como UTC puro.
    return new Date(`${partes}T00:00:00.000Z`);
  }

  /**
   * Grava (ou atualiza) a medicao de um dia.
   *
   * `upsert` e nao `create`: a coleta precisa ser reexecutavel. Um restart do
   * processo, ou uma rodada manual para tapar um buraco, tem que corrigir o
   * ponto do dia em vez de criar um segundo ponto na mesma data — que apareceria
   * no grafico como um degrau que nunca existiu.
   */
  async registrar(
    organizationId: string,
    chave: string,
    valor: number,
    dia = MetricaService.diaDeHoje(),
  ): Promise<void> {
    if (!Number.isFinite(valor)) {
      // Metrica invalida nao entra: um NaN no banco contamina toda soma e
      // media que passar por ele depois.
      this.logger.warn(
        `Valor invalido para "${chave}" da organizacao ${organizationId}; ignorado.`,
      );
      return;
    }

    await this.prisma.metrica.upsert({
      where: {
        organizationId_chave_dia: { organizationId, chave, dia },
      },
      create: { organizationId, chave, valor, dia },
      update: { valor },
    });
  }

  /** Serie de uma metrica, em ordem cronologica. */
  async serie(
    organizationId: string,
    chave: string,
    dias = 90,
  ): Promise<PontoMetrica[]> {
    const desde = new Date(
      MetricaService.diaDeHoje().getTime() - dias * 86_400_000,
    );

    const linhas = await this.prisma.metrica.findMany({
      where: { organizationId, chave, dia: { gte: desde } },
      orderBy: { dia: 'asc' },
    });

    return linhas.map((l) => ({ dia: l.dia, valor: l.valor }));
  }

  /** Quais series esta organizacao ja tem — usado para oferecer graficos. */
  async chavesDisponiveis(organizationId: string): Promise<string[]> {
    const linhas = await this.prisma.metrica.findMany({
      where: { organizationId },
      distinct: ['chave'],
      select: { chave: true },
    });
    return linhas.map((l) => l.chave).sort();
  }
}
