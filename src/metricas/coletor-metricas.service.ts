import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { InstagramService } from '../integrations/instagram/instagram.service';
import { HubspotService } from '../integrations/hubspot/hubspot.service';
import { MetricaService } from './metrica.service';

/** Uma fonte de metricas: de qual conexao depende e o que ela mede. */
interface Coletor {
  /** Provider em Connection (ex: 'instagram'). */
  provedor: string;
  /** Chave do .env usada como fallback global, quando houver. */
  envKey: string;
  /** Mede e devolve as series do dia. */
  medir(token: string): Promise<Record<string, number>>;
}

/**
 * Coleta, uma vez por dia, os numeros que as APIs nao guardam.
 *
 * O produto inteiro do painel de evolucao depende deste servico rodar. Se ele
 * parar por uma semana, existe um buraco de uma semana no grafico do cliente e
 * NAO HA COMO CONSERTAR: o Instagram nao diz quantos seguidores ele tinha na
 * terca passada, e o HubSpot nao guarda como o funil estava. Por isso aqui a
 * regra e falhar barulhento e nunca em cascata — uma integracao quebrada nao
 * pode levar as outras junto.
 */
@Injectable()
export class ColetorMetricasService {
  private readonly logger = new Logger(ColetorMetricasService.name);

  private readonly coletores: Coletor[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly metricas: MetricaService,
    private readonly instagram: InstagramService,
    private readonly hubspot: HubspotService,
  ) {
    this.coletores = [
      {
        provedor: 'instagram',
        envKey: 'INSTAGRAM_ACCESS_TOKEN',
        medir: async (token) => {
          const perfil = await this.instagram.getPerfil(token);
          // Janela de 1 dia: o valor do DIA, nao um acumulado de 7 dias que
          // se sobreporia ao ponto de ontem e inflaria a serie.
          const m = await this.instagram.getMetricas(token, 1);

          const series: Record<string, number> = {
            'instagram.seguidores': perfil.seguidores,
            'instagram.publicacoes': perfil.publicacoes,
          };
          // Metricas de insights podem vir ausentes (conta nova, permissao
          // faltando). Ausente e diferente de zero: gravar 0 desenharia uma
          // queda a pique que nao aconteceu.
          if (m.visualizacoes !== undefined) {
            series['instagram.visualizacoes'] = m.visualizacoes;
          }
          if (m.alcance !== undefined) series['instagram.alcance'] = m.alcance;
          if (m.contasEngajadas !== undefined) {
            series['instagram.contas_engajadas'] = m.contasEngajadas;
          }
          if (m.interacoes !== undefined) {
            series['instagram.interacoes'] = m.interacoes;
          }
          return series;
        },
      },
      {
        provedor: 'hubspot',
        envKey: 'HUBSPOT_ACCESS_TOKEN',
        medir: async (token) => {
          const funil = await this.hubspot.resumoDoFunil(token);
          if (funil.truncado) {
            this.logger.warn(
              'Funil do HubSpot truncado na paginacao: o valor do dia esta subestimado.',
            );
          }

          let valor = 0;
          for (const e of funil.porEstagio.values()) valor += e.valor;

          return {
            'hubspot.negocios': funil.total,
            'hubspot.funil.valor': valor,
          };
        },
      },
    ];
  }

  /**
   * 03:10 no fuso de Sao Paulo.
   *
   * De madrugada porque nenhum cliente esta olhando o painel, e as APIs de
   * terceiros estao menos disputadas. Os 10 minutos evitam a hora cheia, onde
   * todo mundo agenda cron e as APIs respondem pior.
   */
  @Cron('10 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async coletarDiariamente(): Promise<void> {
    await this.coletarTudo();
  }

  /** Exposto separado do @Cron para rodar sob demanda e em teste. */
  async coletarTudo(): Promise<{ organizacoes: number; series: number }> {
    const organizacoes = await this.prisma.organization.findMany({
      select: { id: true, name: true, demo: true },
    });

    let series = 0;
    let atendidas = 0;

    for (const org of organizacoes) {
      // Organizacao de demonstracao nao tem numero real para medir.
      if (org.demo) continue;

      const gravadas = await this.coletarDaOrganizacao(org.id);
      if (gravadas > 0) atendidas++;
      series += gravadas;
    }

    this.logger.log(
      `Coleta diaria concluida: ${series} series gravadas em ${atendidas} organizacoes.`,
    );
    return { organizacoes: atendidas, series };
  }

  /**
   * Coleta de UMA organizacao. Nunca lanca.
   *
   * Um cliente com token vencido nao pode interromper a coleta dos outros —
   * seria transformar o problema de um em buraco no historico de todos.
   */
  async coletarDaOrganizacao(organizationId: string): Promise<number> {
    let gravadas = 0;

    for (const coletor of this.coletores) {
      let token: string | undefined;
      try {
        token = await this.connections.resolveToken(
          { organizationId },
          coletor.provedor,
          coletor.envKey,
        );
      } catch (erro: unknown) {
        this.logger.warn(
          `Nao consegui resolver a credencial de ${coletor.provedor} para ${organizationId}: ${this.detalhe(erro)}`,
        );
        continue;
      }

      // Sem conexao nao e erro: o cliente simplesmente nao usa essa integracao.
      if (!token) continue;

      try {
        const series = await coletor.medir(token);
        for (const [chave, valor] of Object.entries(series)) {
          await this.metricas.registrar(organizationId, chave, valor);
          gravadas++;
        }
      } catch (erro: unknown) {
        // WARN e nao DEBUG: cada falha aqui e um ponto que nunca mais vai
        // existir no grafico. Precisa aparecer para alguem.
        this.logger.warn(
          `Falha ao coletar ${coletor.provedor} da organizacao ${organizationId}: ${this.detalhe(erro)}`,
        );
      }
    }

    return gravadas;
  }

  private detalhe(erro: unknown): string {
    return erro instanceof Error ? erro.message : String(erro);
  }
}
