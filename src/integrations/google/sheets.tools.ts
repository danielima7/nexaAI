import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { GoogleService } from './google.service';
import { SheetsService } from './sheets.service';

/**
 * Ferramentas de Planilhas, multi-tenant.
 *
 * Os nomes usam o prefixo generico `planilha_` (e nao `sheets_`) de proposito:
 * seguindo a filosofia de Universal Actions, o usuario pede "adiciona na
 * planilha de vendas" sem saber qual plataforma esta por baixo. Quando houver
 * Excel Online, o mesmo verbo atendera o outro backend.
 *
 * A credencial e a mesma do Google (Connection provider 'google'), pois a
 * organizacao autoriza Gmail, Agenda e Planilhas num unico consentimento.
 */
@Injectable()
export class SheetsTools implements OnModuleInit {
  private readonly logger = new Logger(SheetsTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly google: GoogleService,
    private readonly sheets: SheetsService,
    private readonly connections: ConnectionsService,
  ) {}

  private token(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(
      context,
      'google',
      'GOOGLE_REFRESH_TOKEN',
    );
  }

  private naoConectado(): string {
    return 'As planilhas ainda nao estao conectadas para a sua organizacao. Peca o link de conexao do Google.';
  }

  /** Formata uma matriz de celulas como tabela simples, legivel no WhatsApp. */
  private tabela(valores: string[][]): string {
    return valores
      .map((linha, i) => `${i + 1}. ${linha.join(' | ')}`)
      .join('\n');
  }

  onModuleInit(): void {
    if (!this.google.isConfigured()) {
      this.logger.warn(
        'Google nao configurado (client id/secret) — ferramentas de planilha nao registradas.',
      );
      return;
    }

    this.registry.register({
      definition: {
        name: 'planilha_listar',
        description:
          'Lista as planilhas do usuario, opcionalmente filtrando pelo nome. Use SEMPRE que precisar descobrir o ID de uma planilha que o usuario citou pelo nome (ex: "planilha de vendas"), antes de ler ou escrever nela.',
        input_schema: {
          type: 'object',
          properties: {
            nome: {
              type: 'string',
              description:
                'Parte do nome da planilha para filtrar (opcional; sem isso lista as mais recentes)',
            },
            limite: {
              type: 'number',
              description: 'Quantas planilhas listar (padrao 20)',
            },
          },
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const planilhas = await this.sheets.listarPlanilhas(
          token,
          input?.nome,
          input?.limite ?? 20,
        );
        if (planilhas.length === 0) {
          return input?.nome
            ? `Nenhuma planilha encontrada com "${input.nome}" no nome.`
            : 'Nenhuma planilha encontrada nesta conta Google.';
        }
        return `Planilhas (${planilhas.length}):\n${planilhas
          .map((p) => `- ${p.nome} (id: ${p.id})`)
          .join('\n')}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'planilha_listar_abas',
        description:
          'Lista as abas (guias) de uma planilha e seu tamanho. Use antes de ler ou escrever quando nao souber o nome exato da aba.',
        input_schema: {
          type: 'object',
          properties: {
            planilha_id: {
              type: 'string',
              description: 'ID da planilha (ou a URL completa)',
            },
          },
          required: ['planilha_id'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const { titulo, abas } = await this.sheets.listarAbas(
          token,
          input.planilha_id,
        );
        if (abas.length === 0) return `A planilha "${titulo}" nao tem abas.`;
        return `Planilha "${titulo}" — abas:\n${abas
          .map((a) => `- ${a.nome} (${a.linhas ?? '?'} linhas)`)
          .join('\n')}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'planilha_ler',
        description:
          'Le os dados de uma planilha e devolve as linhas. Use para responder perguntas sobre os dados (totais, medias, buscas, comparacoes) — leia e faca voce mesmo a analise. Informe apenas o nome da aba para trazer tudo, ou notacao A1 para um trecho.',
        input_schema: {
          type: 'object',
          properties: {
            planilha_id: {
              type: 'string',
              description: 'ID da planilha (ou a URL completa)',
            },
            intervalo: {
              type: 'string',
              description:
                'Nome da aba (ex: "Vendas") ou intervalo A1 (ex: "Vendas!A1:E100")',
            },
            limite: {
              type: 'number',
              description: 'Maximo de linhas a trazer (padrao 50, teto 200)',
            },
          },
          required: ['planilha_id', 'intervalo'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const { valores, truncado, total } = await this.sheets.lerIntervalo(
          token,
          input.planilha_id,
          input.intervalo,
          input?.limite ?? 50,
        );
        if (valores.length === 0) {
          return `Nenhum dado encontrado em "${input.intervalo}".`;
        }
        const aviso = truncado
          ? `\n\n(Mostrando ${valores.length} de ${total} linhas. Peca um intervalo menor ou um limite maior se precisar do restante.)`
          : '';
        return `Dados de "${input.intervalo}" (${valores.length} linhas):\n${this.tabela(valores)}${aviso}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'planilha_adicionar_linha',
        description:
          'Acrescenta uma nova linha ao final de uma aba. Use quando o usuario quiser registrar/lancar algo (uma venda, um gasto, um cliente, um pedido). Os valores devem estar na MESMA ORDEM das colunas da planilha — se nao souber a ordem, leia o cabecalho antes com planilha_ler.',
        input_schema: {
          type: 'object',
          properties: {
            planilha_id: {
              type: 'string',
              description: 'ID da planilha (ou a URL completa)',
            },
            aba: {
              type: 'string',
              description: 'Nome da aba onde inserir (ex: "Vendas")',
            },
            valores: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Valores da linha, na ordem das colunas (ex: ["25/07/2026", "Joao", "500"])',
            },
          },
          required: ['planilha_id', 'aba', 'valores'],
        },
      },
      escrita: true,
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const onde = await this.sheets.adicionarLinha(
          token,
          input.planilha_id,
          input.aba,
          input.valores,
        );
        return `Linha adicionada em ${onde}: ${input.valores.join(' | ')}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'planilha_atualizar',
        description:
          'Atualiza uma celula ou um intervalo de celulas com novos valores. Use para corrigir ou alterar dados existentes. Confirme com o usuario antes de sobrescrever dados.',
        input_schema: {
          type: 'object',
          properties: {
            planilha_id: {
              type: 'string',
              description: 'ID da planilha (ou a URL completa)',
            },
            intervalo: {
              type: 'string',
              description:
                'Celula ou intervalo em notacao A1 (ex: "Vendas!C5" ou "Vendas!A2:C2")',
            },
            valores: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description:
                'Matriz de valores (lista de linhas). Para uma unica celula: [["novo valor"]]',
            },
          },
          required: ['planilha_id', 'intervalo', 'valores'],
        },
      },
      escrita: true,
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const celulas = await this.sheets.atualizarIntervalo(
          token,
          input.planilha_id,
          input.intervalo,
          input.valores,
        );
        return `${celulas} celula(s) atualizada(s) em ${input.intervalo}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'planilha_criar',
        description:
          'Cria uma planilha nova, opcionalmente ja com a linha de cabecalho. Use quando o usuario pedir para comecar um controle novo (ex: "cria uma planilha de controle de gastos").',
        input_schema: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Nome da planilha' },
            cabecalho: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Nomes das colunas (opcional, ex: ["Data", "Cliente", "Valor"])',
            },
          },
          required: ['titulo'],
        },
      },
      escrita: true,
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const { id, url } = await this.sheets.criarPlanilha(
          token,
          input.titulo,
          input.cabecalho,
        );
        return `Planilha "${input.titulo}" criada. ✅\nID: ${id}\nLink: ${url}`;
      },
    });

    this.logger.log('Ferramentas de planilha (Google Sheets) registradas (multi-tenant).');
  }
}
