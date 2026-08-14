import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { SheetsService } from '../integrations/google/sheets.service';
import { HubspotService } from '../integrations/hubspot/hubspot.service';
import { MetricaService } from '../metricas/metrica.service';
import { Prisma } from '@prisma/client';
import { montarSerie, Serie, SerieError } from './serie';
import {
  ConfigPlanilha,
  DadosCard,
  Ponto,
  TipoGrafico,
  Variacao,
} from './painel.types';
import { INDICADORES, Modulo } from './indicadores';

/**
 * Monta o painel de uma organizacao.
 *
 * A IA nao participa desta etapa. Ela ja decidiu o mapeamento uma vez, na
 * conversa em que o cliente pediu o grafico; daqui em diante e leitura de
 * planilha mais agregacao em codigo. Isso importa por tres motivos: a tela
 * abre rapido, nao custa token por visita, e o mesmo card mostra sempre a
 * mesma coisa — grafico que muda de opiniao sozinho destroi a confianca no
 * numero.
 */
@Injectable()
export class PainelService {
  private readonly logger = new Logger(PainelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly sheets: SheetsService,
    private readonly hubspot: HubspotService,
    private readonly metricas: MetricaService,
  ) {}

  /** Provedores que esta organizacao ja conectou. */
  async provedoresConectados(organizationId: string): Promise<string[]> {
    return this.connections.listProviders(organizationId);
  }

  /** Salva um indicador pronto do catalogo (Instagram, HubSpot). */
  async criarIndicador(
    organizationId: string,
    dados: {
      titulo: string;
      fonte: string;
      tipo: TipoGrafico;
      config: Record<string, unknown>;
      ordem: number;
    },
  ) {
    return this.prisma.painelCard.create({
      data: {
        organizationId,
        titulo: dados.titulo,
        fonte: dados.fonte,
        tipo: dados.tipo,
        config: dados.config as Prisma.InputJsonValue,
        ordem: dados.ordem,
      },
    });
  }

  /** Cards salvos da organizacao, na ordem de exibicao. */
  async listarCards(organizationId: string) {
    return this.prisma.painelCard.findMany({
      where: { organizationId },
      orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Monta todos os cards do painel.
   *
   * `allSettled` e proposital: uma planilha apagada ou renomeada nao pode
   * derrubar a tela inteira. O card que falhou mostra o motivo e os outros
   * continuam funcionando — e o motivo e escrito para o dono da PME ler, nao
   * para aparecer num log.
   */
  async montarPainel(organizationId: string): Promise<DadosCard[]> {
    const cards = await this.listarCards(organizationId);
    if (cards.length === 0) return [];

    const token = await this.connections.resolveToken(
      { organizationId },
      'google',
      'GOOGLE_REFRESH_TOKEN',
    );

    const resultados = await Promise.allSettled(
      cards.map((card) => this.montarCard(card, token)),
    );

    return resultados.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : this.cardComErro(cards[i], this.mensagemDeErro(r.reason)),
    );
  }

  /**
   * Monta a serie de uma configuracao que AINDA NAO foi salva.
   *
   * Usado na criacao do grafico: valida o mapeamento contra a planilha de
   * verdade antes de gravar. Sem isso, um nome de coluna que a IA errou viraria
   * um card quebrado no painel — e o cliente nao tem como consertar sozinho,
   * porque quem escolheu as colunas nao foi ele.
   *
   * Lanca SerieError com mensagem legivel quando o mapeamento nao serve.
   */
  async previsualizar(
    organizationId: string,
    config: ConfigPlanilha,
  ): Promise<Serie> {
    const token = await this.connections.resolveToken(
      { organizationId },
      'google',
      'GOOGLE_REFRESH_TOKEN',
    );
    if (!token) {
      throw new SerieError(
        'O Google não está conectado para a sua organização.',
      );
    }

    const { valores } = await this.sheets.lerParaAnalise(
      token,
      config.planilhaId,
      config.aba?.trim() || 'A:ZZ',
    );

    return montarSerie(valores, config);
  }

  /** Salva um grafico novo no painel da organizacao. */
  async criarCard(
    organizationId: string,
    dados: {
      titulo: string;
      tipo: TipoGrafico;
      config: ConfigPlanilha;
      ordem: number;
    },
  ) {
    return this.prisma.painelCard.create({
      data: {
        organizationId,
        titulo: dados.titulo,
        fonte: 'planilha_google',
        tipo: dados.tipo,
        config: dados.config as unknown as Prisma.InputJsonValue,
        ordem: dados.ordem,
      },
    });
  }

  /**
   * Remove um card.
   *
   * O `organizationId` entra no WHERE, e nao so o id: sem ele, um id vazado
   * apagaria o grafico de outro cliente. Isolamento de tenant nao pode
   * depender de o chamador ter conferido antes.
   */
  async removerCard(organizationId: string, cardId: string): Promise<void> {
    await this.prisma.painelCard.deleteMany({
      where: { id: cardId, organizationId },
    });
  }

  /** Monta um card. Lanca em falha — quem chama decide como exibir. */
  private async montarCard(
    card: {
      id: string;
      titulo: string;
      tipo: string;
      fonte: string;
      config: unknown;
      organizationId: string;
    },
    token: string | undefined,
  ): Promise<DadosCard> {
    switch (card.fonte) {
      case 'planilha_google':
        return this.cardDePlanilha(card, token);
      case 'metrica_historica':
        return this.cardDeSerie(card);
      case 'hubspot_funil':
        return this.cardDeFunil(card);
      default:
        throw new SerieError(
          `Fonte de dados "${card.fonte}" ainda não é suportada neste painel.`,
        );
    }
  }

  /**
   * Card que le a serie gravada pela coleta diaria.
   *
   * Nao chama API nenhuma: o numero ja foi medido de madrugada. Por isso este
   * e o card mais rapido e o mais resistente — funciona mesmo com o Instagram
   * fora do ar, porque o historico e nosso.
   */
  private async cardDeSerie(card: {
    id: string;
    titulo: string;
    tipo: string;
    config: unknown;
    organizationId: string;
  }): Promise<DadosCard> {
    const config = card.config as { chave: string; dias?: number };
    const serie = await this.metricas.serie(
      card.organizationId,
      config.chave,
      config.dias ?? 90,
    );

    const pontos = serie.map((p) => ({
      rotulo: PainelService.rotuloDeDia(p.dia),
      valor: p.valor,
      ordem: p.dia.toISOString().slice(0, 10),
    }));

    return {
      id: card.id,
      titulo: card.titulo,
      tipo: card.tipo as TipoGrafico,
      pontos,
      modulo: PainelService.moduloDoCard('metrica_historica', config),
      variacao: PainelService.variacao(pontos, true, config.dias ?? 90),
      linhasLidas: pontos.length,
      linhasIgnoradas: 0,
      eixoTemporal: true,
      // Uma serie de um ponto so nao desenha evolucao nenhuma. Dizer isso e
      // melhor que mostrar um grafico vazio e deixar o cliente achar que
      // quebrou — o dado vai aparecer, so precisa de dias.
      aviso:
        pontos.length < 2
          ? 'A medição começou agora. O gráfico ganha forma conforme os próximos dias forem medidos.'
          : undefined,
    };
  }

  /**
   * Card do funil do HubSpot, ao vivo.
   *
   * Ao vivo, e nao da serie, porque a pergunta e "como esta meu funil AGORA".
   * A evolucao do funil no tempo e outro card, alimentado pela coleta diaria.
   */
  private async cardDeFunil(card: {
    id: string;
    titulo: string;
    tipo: string;
    organizationId: string;
  }): Promise<DadosCard> {
    const token = await this.connections.resolveToken(
      { organizationId: card.organizationId },
      'hubspot',
      'HUBSPOT_ACCESS_TOKEN',
    );
    if (!token) {
      throw new SerieError(
        'O HubSpot não está conectado para a sua organização. Conecte em Integrações.',
      );
    }

    const [funil, estagios] = await Promise.all([
      this.hubspot.resumoDoFunil(token),
      // Traduz o id interno do estagio para o nome que o cliente ve no CRM.
      // Sem isto o grafico mostraria "appointmentscheduled" no eixo.
      this.hubspot.getDealStages(token).catch(() => []),
    ]);

    const nomes = new Map(estagios.map((e) => [e.id, e.label]));
    const pontos = [...funil.porEstagio.entries()].map(([id, dados]) => ({
      // `sem_estagio` e um sentinela NOSSO, para negocio sem estagio definido
      // no CRM. Sem esta traducao ele apareceria cru no grafico do cliente.
      rotulo:
        id === 'sem_estagio' ? 'Sem estágio' : (nomes.get(id) ?? id),
      valor: dados.valor,
    }));

    return {
      id: card.id,
      titulo: card.titulo,
      tipo: card.tipo as TipoGrafico,
      pontos,
      modulo: 'CRM',
      linhasLidas: funil.total,
      linhasIgnoradas: 0,
      eixoTemporal: false,
      aviso: funil.truncado
        ? 'Seu CRM tem mais negócios do que conseguimos ler de uma vez; este total está subestimado.'
        : undefined,
    };
  }

  /**
   * Modulo a que o card pertence, para agrupar a tela por origem.
   *
   * Derivado da fonte e da chave, e nao gravado no PainelCard: assim um card
   * criado antes desta tela existir ja aparece na secao certa, sem migracao.
   */
  static moduloDoCard(fonte: string, config: unknown): Modulo {
    if (fonte === 'planilha_google') return 'Planilhas';
    if (fonte === 'hubspot_funil') return 'CRM';

    const chave = String((config as { chave?: string })?.chave ?? '');
    const indicador = INDICADORES.find((i) => i.chave === chave);
    if (indicador) return indicador.modulo;

    // Serie de uma integracao que ainda nao esta no catalogo: cai pelo prefixo
    // em vez de sumir da tela.
    if (chave.startsWith('instagram.')) return 'Redes sociais';
    if (chave.startsWith('hubspot.')) return 'CRM';
    return 'Planilhas';
  }

  /**
   * Variacao do primeiro ao ultimo ponto.
   *
   * Devolve undefined com menos de dois pontos: um ponto nao tem variacao, e
   * mostrar "0%" faria o cliente ler estabilidade onde nao houve medida.
   * Tambem so vale em serie temporal — "variacao" entre categorias (Cliente vs
   * Gestor) nao significa nada.
   */
  private static variacao(
    pontos: Ponto[],
    eixoTemporal: boolean,
    dias: number,
  ): Variacao | undefined {
    if (!eixoTemporal || pontos.length < 2) return undefined;

    const primeiro = pontos[0].valor;
    const ultimo = pontos[pontos.length - 1].valor;
    const absoluto = ultimo - primeiro;

    return {
      absoluto,
      // Sem base nao ha percentual: dividir por zero daria Infinity, e "cresceu
      // infinito" e pior que nao dizer nada.
      percentual: primeiro === 0 ? undefined : (absoluto / Math.abs(primeiro)) * 100,
      dias,
    };
  }

  /** Rotulo curto de um dia: 13/08. */
  private static rotuloDeDia(dia: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(dia.getUTCDate())}/${p2(dia.getUTCMonth() + 1)}`;
  }

  /** Card alimentado por uma planilha do Google. */
  private async cardDePlanilha(
    card: { id: string; titulo: string; tipo: string; config: unknown },
    token: string | undefined,
  ): Promise<DadosCard> {
    if (!token) {
      throw new SerieError(
        'O Google não está conectado para a sua organização. ' +
          'Conecte em Integrações para o painel voltar a ler suas planilhas.',
      );
    }

    const config = card.config as ConfigPlanilha;
    // Aba vazia = primeira aba. O Sheets aceita o intervalo sem nome de aba,
    // e e o caso comum: planilha de PME costuma ter uma aba so.
    const intervalo = config.aba?.trim() || 'A:ZZ';

    const { valores, truncado, total } = await this.sheets.lerParaAnalise(
      token,
      config.planilhaId,
      intervalo,
    );

    const serie = montarSerie(valores, config);

    if (truncado) {
      this.logger.warn(
        `Card ${card.id}: planilha com ${total} linhas foi truncada em ${SheetsService.MAX_LINHAS_ANALISE}.`,
      );
    }

    return {
      id: card.id,
      titulo: card.titulo,
      tipo: card.tipo as TipoGrafico,
      modulo: 'Planilhas',
      pontos: serie.pontos,
      linhasLidas: serie.linhasLidas,
      linhasIgnoradas: serie.linhasIgnoradas,
      eixoTemporal: serie.eixoTemporal,
    };
  }

  /** Card que nao pode ser montado, com o motivo no lugar dos dados. */
  private cardComErro(
    card: { id: string; titulo: string; tipo: string; fonte: string; config: unknown },
    erro: string,
  ): DadosCard {
    return {
      id: card.id,
      titulo: card.titulo,
      tipo: card.tipo as TipoGrafico,
      // O modulo vem mesmo no erro: o card precisa aparecer na secao certa,
      // senao o cliente nao descobre qual integracao esta com problema.
      modulo: PainelService.moduloDoCard(card.fonte, card.config),
      pontos: [],
      linhasLidas: 0,
      linhasIgnoradas: 0,
      eixoTemporal: false,
      erro,
    };
  }

  /**
   * Traduz a falha para uma frase que o dono da PME entenda.
   *
   * SerieError ja nasce escrito para ele. O resto vem do Google e traz codigo
   * HTTP e stack — mostrar isso na tela do cliente nao ajuda ninguem e ainda
   * vaza detalhe de infraestrutura.
   */
  private mensagemDeErro(erro: unknown): string {
    if (erro instanceof SerieError) return erro.message;

    const bruto = erro instanceof Error ? erro.message : String(erro);
    this.logger.error(`Falha ao montar card do painel: ${bruto}`);

    if (bruto.includes('invalid_grant')) {
      return 'A autorização do Google expirou. Reconecte em Integrações para o painel voltar a funcionar.';
    }
    if (bruto.includes('404') || bruto.toLowerCase().includes('not found')) {
      return 'Não encontrei essa planilha. Ela pode ter sido apagada ou o acesso removido.';
    }
    if (bruto.includes('Unable to parse range')) {
      return 'A aba usada por este gráfico não existe mais na planilha.';
    }

    return 'Não consegui carregar este gráfico agora. Tente novamente em alguns instantes.';
  }
}
