import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolContext } from '../tools/tool.interface';

/**
 * Ferramentas de alerta.
 *
 * A IA escolhe QUAL ferramenta o alerta deve executar — ela ja conhece todas as
 * disponiveis, entao "me avise sobre inadimplentes" vira
 * `ferramenta: asaas_cobrancas_vencidas` sem precisarmos manter um mapa de
 * intencoes aqui.
 */
@Injectable()
export class AlertTools implements OnModuleInit {
  private readonly logger = new Logger(AlertTools.name);

  /** Menor intervalo aceito, para nao martelar as APIs dos clientes. */
  private static readonly FREQUENCIA_MINIMA = 15;

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  private semOrganizacao(): string {
    return 'Nao consegui identificar sua organizacao.';
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'kyrius_criar_alerta',
        description:
          'Cria um alerta que avisa o usuario por e-mail quando algo mudar (ex: novo cliente inadimplente, boleto vencido, queda de saldo, novos seguidores). Escolha em "ferramenta" o nome de uma ferramenta de CONSULTA existente que responda ao que ele quer acompanhar. Use quando o usuario pedir para ser avisado, monitorar ou acompanhar algo.',
        input_schema: {
          type: 'object',
          properties: {
            descricao: {
              type: 'string',
              description:
                'O que o usuario quer acompanhar, com as palavras dele. Ex: "clientes inadimplentes".',
            },
            ferramenta: {
              type: 'string',
              description:
                'Nome exato da ferramenta de consulta a executar periodicamente. Ex: asaas_cobrancas_vencidas.',
            },
            argumentos: {
              type: 'object',
              description:
                'Argumentos da ferramenta, se ela precisar de algum. Omita se nao precisar.',
            },
            frequencia_minutos: {
              type: 'number',
              description:
                'De quanto em quanto tempo verificar. Padrao 60, minimo 15.',
            },
          },
          required: ['descricao', 'ferramenta'],
        },
      },
      escrita: true,
      execute: async (input, context: ToolContext | undefined) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const ferramenta = String(input?.ferramenta ?? '').trim();
        if (!this.registry.existe(ferramenta)) {
          return `Nao existe uma ferramenta chamada "${ferramenta}". Escolha uma das ferramentas de consulta disponiveis.`;
        }

        const frequencia = Math.max(
          AlertTools.FREQUENCIA_MINIMA,
          Number(input?.frequencia_minutos) || 60,
        );

        const alerta = await this.prisma.alert.create({
          data: {
            organizationId: context.organizationId,
            descricao: String(input.descricao).trim(),
            ferramenta,
            argumentos: input?.argumentos ?? undefined,
            frequenciaMin: frequencia,
          },
        });

        this.logger.log(
          `Alerta criado para a organizacao ${context.organizationId}: ${alerta.descricao}`,
        );

        return [
          `Alerta criado: "${alerta.descricao}".`,
          `Vou verificar a cada ${frequencia} minutos e te avisar por e-mail assim que houver mudanca.`,
          'A primeira verificacao serve so para registrar a situacao atual — o aviso vem quando algo mudar em relacao a ela.',
        ].join(' ');
      },
    });

    this.registry.register({
      definition: {
        name: 'kyrius_listar_alertas',
        description:
          'Lista os alertas configurados pela organizacao. Use quando o usuario perguntar o que esta sendo monitorado ou quais avisos ele criou.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context: ToolContext | undefined) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const alertas = await this.prisma.alert.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { createdAt: 'asc' },
        });

        if (alertas.length === 0) {
          return 'Nenhum alerta configurado. Posso criar um — e so dizer o que voce quer acompanhar.';
        }

        return [
          `Alertas configurados (${alertas.length}):`,
          ...alertas.map((a, i) => {
            const estado = a.ativo ? 'ativo' : 'pausado';
            const ultimo = a.lastFiredAt
              ? ` — ultimo aviso em ${a.lastFiredAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
              : ' — ainda nao disparou';
            return `${i + 1}. ${a.descricao} (${estado}, a cada ${a.frequenciaMin} min)${ultimo}`;
          }),
        ].join('\n');
      },
    });

    this.registry.register({
      definition: {
        name: 'kyrius_remover_alerta',
        description:
          'Remove um alerta pelo numero mostrado na listagem. Use quando o usuario pedir para parar de receber um aviso.',
        input_schema: {
          type: 'object',
          properties: {
            numero: {
              type: 'number',
              description: 'Numero do alerta conforme a lista de alertas.',
            },
          },
          required: ['numero'],
        },
      },
      escrita: true,
      execute: async (input, context: ToolContext | undefined) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const alertas = await this.prisma.alert.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { createdAt: 'asc' },
        });

        const indice = Number(input?.numero) - 1;
        const alerta = alertas[indice];
        if (!alerta) {
          return `Nao encontrei o alerta numero ${input?.numero}. Peca a lista de alertas para conferir.`;
        }

        await this.prisma.alert.delete({ where: { id: alerta.id } });
        return `Alerta removido: "${alerta.descricao}". Voce nao recebera mais avisos sobre isso.`;
      },
    });
  }
}
