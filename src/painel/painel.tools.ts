import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolContext } from '../tools/tool.interface';
import { PainelService } from './painel.service';
import { SheetsService } from '../integrations/google/sheets.service';
import { GoogleService } from '../integrations/google/google.service';
import { Agregacao, Agrupamento, TipoGrafico } from './painel.types';
import { acharIndicador, INDICADORES } from './indicadores';

/**
 * Ferramentas do painel: e por aqui que a IA cria um grafico.
 *
 * A ideia central do produto aparece aqui inteira. O cliente nao configura
 * eixo X, eixo Y e tipo de grafico numa tela: ele diz "quero acompanhar minhas
 * vendas por mes", a IA olha o cabecalho da planilha, decide o mapeamento e
 * salva. Da proxima vez que ele abrir o painel, o grafico ja esta la — montado
 * em codigo puro, sem IA e sem custo.
 *
 * A IA participa UMA vez, na criacao. Nunca na exibicao.
 */
@Injectable()
export class PainelTools implements OnModuleInit {
  private readonly logger = new Logger(PainelTools.name);

  /** Teto de cards por organizacao. Painel nao e lista infinita. */
  private static readonly MAX_CARDS = 12;

  private static readonly AGREGACOES: Agregacao[] = [
    'soma',
    'media',
    'contagem',
    'maximo',
    'minimo',
  ];
  private static readonly TIPOS: TipoGrafico[] = ['barra', 'linha', 'numero'];
  private static readonly AGRUPAMENTOS: Agrupamento[] = ['dia', 'mes', 'ano'];

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly painel: PainelService,
    private readonly sheets: SheetsService,
    private readonly google: GoogleService,
  ) {}

  private semOrganizacao(): string {
    return 'Nao consegui identificar a organizacao desta conversa.';
  }

  onModuleInit(): void {
    if (!this.google.isConfigured()) {
      this.logger.warn(
        'Google nao configurado — ferramentas do painel nao registradas.',
      );
      return;
    }

    this.registrarCriar();
    this.registrarIndicador();
    this.registrarListar();
    this.registrarRemover();
  }

  /**
   * Indicadores prontos (Instagram, HubSpot).
   *
   * Ferramenta separada da de planilha de proposito: sao dois problemas
   * diferentes. Planilha exige descobrir colunas; aqui o schema e fixo e o
   * cliente so escolhe da lista. Juntar os dois num schema so criaria uma
   * ferramenta com metade dos campos sempre vazios, e a IA erraria mais.
   */
  private registrarIndicador(): void {
    this.registry.register({
      definition: {
        name: 'painel_adicionar_indicador',
        description:
          'Adiciona ao Painel um indicador pronto do Instagram ou do HubSpot ' +
          '(seguidores, alcance, funil de vendas). Use quando o usuario quiser acompanhar ' +
          'redes sociais ou CRM. Para dados de PLANILHA use painel_criar_grafico. ' +
          'Indicadores disponiveis:\n' +
          INDICADORES.map((i) => `  ${i.id} — ${i.titulo}: ${i.descricao}`).join('\n'),
        input_schema: {
          type: 'object',
          properties: {
            indicador: {
              type: 'string',
              enum: INDICADORES.map((i) => i.id),
              description: 'Id do indicador da lista.',
            },
            titulo: {
              type: 'string',
              description:
                'Titulo do card. Omita para usar o padrao do indicador.',
            },
            dias: {
              type: 'number',
              description:
                'Janela do historico, em dias (padrao 90). So vale para indicadores de evolucao.',
            },
          },
          required: ['indicador'],
        },
      },
      escrita: true,
      execute: async (input, context?: ToolContext) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const indicador = acharIndicador(input.indicador);
        if (!indicador) {
          return `Indicador "${input.indicador}" nao existe. Disponiveis: ${INDICADORES.map((i) => i.id).join(', ')}.`;
        }

        const existentes = await this.painel.listarCards(context.organizationId);
        if (existentes.length >= PainelTools.MAX_CARDS) {
          return `O painel ja tem ${existentes.length} graficos, que e o limite. Remova um antes de criar outro.`;
        }

        // Sem a conexao, o card nasceria mostrando erro. Barrar aqui permite
        // a IA orientar o cliente a conectar antes, o que resolve de verdade.
        const conectados = await this.painel.provedoresConectados(
          context.organizationId,
        );
        if (!conectados.includes(indicador.provedor)) {
          return (
            `O ${indicador.provedor} ainda nao esta conectado para esta organizacao. ` +
            'Peca ao usuario para conectar na pagina de Integracoes e tente de novo.'
          );
        }

        const config: Record<string, unknown> =
          indicador.fonte === 'metrica_historica'
            ? {
                chave: indicador.chave,
                dias:
                  typeof input.dias === 'number' && input.dias > 0
                    ? Math.floor(input.dias)
                    : 90,
              }
            : {};

        const card = await this.painel.criarIndicador(context.organizationId, {
          titulo: String(input.titulo ?? indicador.titulo).trim(),
          fonte: indicador.fonte,
          tipo: indicador.tipo,
          config,
          ordem: existentes.length,
        });

        // O aviso sobre historico e obrigatorio nos indicadores de evolucao:
        // o Instagram nao informa quantos seguidores havia mes passado, entao
        // prometer um grafico cheio para quem conectou ontem seria mentira.
        const ressalva =
          indicador.fonte === 'metrica_historica'
            ? ' A medicao e diaria e comecou quando a integracao foi conectada, ' +
              'entao o grafico vai ganhando forma com o passar dos dias — nao da ' +
              'para recuperar o periodo anterior.'
            : '';

        return `Indicador "${card.titulo}" adicionado ao Painel.${ressalva}`;
      },
    });
  }

  private registrarCriar(): void {
    this.registry.register({
      definition: {
        name: 'painel_criar_grafico',
        description:
          'Cria um grafico fixo no Painel do cliente, a partir de uma planilha. ' +
          'Use quando o usuario quiser ACOMPANHAR algo de forma recorrente ' +
          '("quero ver minhas vendas por mes", "coloca isso no painel", ' +
          '"cria um grafico de despesas por categoria"). ' +
          'NAO use para responder uma pergunta pontual — para isso leia a planilha e responda no texto. ' +
          'ANTES de chamar: use planilha_listar para achar o ID e planilha_ler para ver os nomes exatos ' +
          'das colunas no cabecalho. Os nomes informados aqui devem ser os que aparecem na planilha.',
        input_schema: {
          type: 'object',
          properties: {
            titulo: {
              type: 'string',
              description:
                'Titulo do card, com as palavras do usuario (ex: "Vendas por mes").',
            },
            planilha_id: {
              type: 'string',
              description: 'ID da planilha (ou a URL completa).',
            },
            aba: {
              type: 'string',
              description:
                'Nome da aba. Omita quando a planilha tiver uma aba so.',
            },
            coluna_rotulo: {
              type: 'string',
              description:
                'Nome exato da coluna do eixo X — datas (para serie temporal) ou categorias (ex: Produto).',
            },
            coluna_valor: {
              type: 'string',
              description: 'Nome exato da coluna numerica do eixo Y (ex: Valor).',
            },
            agregacao: {
              type: 'string',
              enum: ['soma', 'media', 'contagem', 'maximo', 'minimo'],
              description:
                'Como consolidar varias linhas do mesmo rotulo. Padrao soma.',
            },
            agrupar_por: {
              type: 'string',
              enum: ['dia', 'mes', 'ano'],
              description:
                'Granularidade quando o rotulo for data. Padrao mes.',
            },
            tipo: {
              type: 'string',
              enum: ['barra', 'linha', 'numero'],
              description:
                'barra para categorias, linha para evolucao no tempo, numero para um total unico. Padrao barra.',
            },
            limite_pontos: {
              type: 'number',
              description:
                'Quantos pontos mostrar, do mais recente para tras (ex: 12 para os ultimos 12 meses).',
            },
          },
          required: ['titulo', 'planilha_id', 'coluna_rotulo', 'coluna_valor'],
        },
      },
      escrita: true,
      execute: async (input, context?: ToolContext) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const existentes = await this.painel.listarCards(context.organizationId);
        if (existentes.length >= PainelTools.MAX_CARDS) {
          return (
            `O painel ja tem ${existentes.length} graficos, que e o limite. ` +
            'Remova um antes de criar outro.'
          );
        }

        const config = {
          planilhaId: SheetsService.extrairId(input.planilha_id),
          aba: input.aba?.trim() || undefined,
          colunaRotulo: String(input.coluna_rotulo).trim(),
          colunaValor: String(input.coluna_valor).trim(),
          agregacao: this.opcao(
            input.agregacao,
            PainelTools.AGREGACOES,
            'soma',
          ),
          agruparPor: this.opcao(
            input.agrupar_por,
            PainelTools.AGRUPAMENTOS,
            'mes',
          ),
          limitePontos:
            typeof input.limite_pontos === 'number' && input.limite_pontos > 0
              ? Math.floor(input.limite_pontos)
              : undefined,
        };

        const tipo = this.opcao(input.tipo, PainelTools.TIPOS, 'barra');

        // VALIDA ANTES DE SALVAR: monta o grafico de verdade e so grava se ele
        // produzir dado. Sem isto, um nome de coluna que a IA errou viraria um
        // card quebrado que o cliente so descobre ao abrir o painel — e ele
        // nao tem como consertar sozinho.
        let previa;
        try {
          previa = await this.painel.previsualizar(
            context.organizationId,
            config,
          );
        } catch (erro: unknown) {
          const motivo = erro instanceof Error ? erro.message : String(erro);
          return `Nao criei o grafico porque a leitura falhou: ${motivo}`;
        }

        if (previa.pontos.length === 0) {
          return (
            'Nao criei o grafico: com essas colunas nenhum dado foi encontrado. ' +
            `Foram lidas ${previa.linhasLidas} linhas e ${previa.linhasIgnoradas} nao tinham numero ` +
            `na coluna "${config.colunaValor}". Confira se as colunas estao corretas.`
          );
        }

        const card = await this.painel.criarCard(context.organizationId, {
          titulo: String(input.titulo).trim(),
          tipo,
          config,
          ordem: existentes.length,
        });

        this.logger.log(
          `Card "${card.titulo}" criado para a organizacao ${context.organizationId}.`,
        );

        // Devolve a previa para a IA confirmar ao usuario com numeros reais —
        // "criei o grafico" sem dado deixaria ele sem saber se ficou certo.
        const amostra = previa.pontos
          .slice(-3)
          .map((p) => `${p.rotulo}: ${this.formatar(p.valor)}`)
          .join(', ');

        const aviso =
          previa.linhasIgnoradas > 0
            ? ` Atencao: ${previa.linhasIgnoradas} de ${previa.linhasLidas} linhas foram ignoradas por nao terem numero na coluna "${config.colunaValor}".`
            : '';

        return (
          `Grafico "${card.titulo}" criado no Painel com ${previa.pontos.length} pontos. ` +
          `Ultimos valores — ${amostra}.${aviso} ` +
          'Ele fica disponivel na aba Painel e atualiza sozinho conforme a planilha muda.'
        );
      },
    });
  }

  private registrarListar(): void {
    this.registry.register({
      definition: {
        name: 'painel_listar_graficos',
        description:
          'Lista os graficos que ja existem no Painel do cliente. Use antes de remover, ' +
          'ou quando o usuario perguntar o que ele tem acompanhando.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context?: ToolContext) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const cards = await this.painel.listarCards(context.organizationId);
        if (cards.length === 0) {
          return 'O painel ainda nao tem nenhum grafico.';
        }

        return `Graficos no painel (${cards.length}):\n${cards
          .map((c, i) => `${i + 1}. ${c.titulo} (${c.tipo})`)
          .join('\n')}`;
      },
    });
  }

  private registrarRemover(): void {
    this.registry.register({
      definition: {
        name: 'painel_remover_grafico',
        description:
          'Remove um grafico do Painel. Use painel_listar_graficos antes, para saber o numero.',
        input_schema: {
          type: 'object',
          properties: {
            numero: {
              type: 'number',
              description: 'Numero do grafico conforme a lista do painel.',
            },
          },
          required: ['numero'],
        },
      },
      escrita: true,
      execute: async (input, context?: ToolContext) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const cards = await this.painel.listarCards(context.organizationId);
        const indice = Number(input.numero) - 1;
        if (!Number.isInteger(indice) || indice < 0 || indice >= cards.length) {
          return `Numero invalido. O painel tem ${cards.length} grafico(s).`;
        }

        const card = cards[indice];
        await this.painel.removerCard(context.organizationId, card.id);
        return `Grafico "${card.titulo}" removido do painel.`;
      },
    });
  }

  /** Aceita so os valores previstos; qualquer outra coisa cai no padrao. */
  private opcao<T extends string>(bruto: unknown, validos: T[], padrao: T): T {
    const valor = String(bruto ?? '').trim().toLowerCase() as T;
    return validos.includes(valor) ? valor : padrao;
  }

  /** Numero em pt-BR, para a IA repetir ao usuario sem reformatar. */
  private formatar(valor: number): string {
    return valor.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
}
