import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';

/**
 * Ferramentas "de sistema" do proprio Kyrius (nao ligadas a uma integracao
 * externa): historico de operacoes e conexao de integracoes por organizacao.
 */
@Injectable()
export class SystemTools implements OnModuleInit {
  private readonly logger = new Logger(SystemTools.name);

  /** Provedores que ja usam credencial por organizacao (Fase 2). */
  private static readonly PROVEDORES_CONECTAVEIS = [
    'hubspot',
    'stripe',
    'mercadopago',
    'asaas',
    'pagarme',
  ];

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'kyrius_conectar_integracao',
        description:
          'Conecta uma integracao para a organizacao do usuario, salvando a credencial (token/chave de API). Use quando o usuario pedir para conectar/configurar uma integracao informando um token. Provedores suportados no momento: hubspot.',
        input_schema: {
          type: 'object',
          properties: {
            provedor: {
              type: 'string',
              description: 'Nome do provedor (ex: hubspot)',
            },
            token: {
              type: 'string',
              description: 'Token/chave de API da conta do usuario',
            },
          },
          required: ['provedor', 'token'],
        },
      },
      execute: async (input, context) => {
        if (!context?.organizationId)
          return 'Nao consegui identificar sua organizacao.';
        const provider = String(input.provedor).toLowerCase();
        if (!SystemTools.PROVEDORES_CONECTAVEIS.includes(provider)) {
          return `Conexao do provedor "${input.provedor}" ainda nao esta disponivel. Disponiveis: ${SystemTools.PROVEDORES_CONECTAVEIS.join(', ')}.`;
        }
        await this.connections.set(context.organizationId, provider, {
          token: input.token,
        });
        return `Integracao ${provider} conectada com sucesso para a sua organizacao. ✅`;
      },
    });

    this.registry.register({
      definition: {
        name: 'kyrius_listar_integracoes',
        description:
          'Lista as integracoes que a organizacao do usuario conectou (com credencial propria). Use quando o usuario perguntar quais integracoes estao conectadas.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        if (!context?.organizationId)
          return 'Nao consegui identificar sua organizacao.';
        const providers = await this.connections.listProviders(
          context.organizationId,
        );
        if (providers.length === 0)
          return 'Sua organizacao ainda nao conectou nenhuma integracao com credencial propria.';
        return `Integracoes conectadas pela sua organizacao: ${providers.join(', ')}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'kyrius_historico_operacoes',
        description:
          'Lista as acoes/operacoes mais recentes que o Kyrius executou para este contato (auditoria). Use quando o usuario perguntar o que voce fez, o historico de acoes, ou o que foi feito recentemente.',
        input_schema: {
          type: 'object',
          properties: {
            limite: {
              type: 'number',
              description: 'Quantidade de operacoes a listar (padrao 10)',
            },
          },
        },
      },
      execute: async (input, context) => {
        const contact = context?.contact;
        if (!contact) {
          return 'Nao consegui identificar o contato para consultar o historico.';
        }
        const logs = await this.prisma.operationLog.findMany({
          where: { contact },
          orderBy: { createdAt: 'desc' },
          take: input?.limite ?? 10,
        });
        if (logs.length === 0) {
          return 'Nenhuma operacao registrada ainda para este contato.';
        }
        const lista = logs
          .map((l) => {
            const status = l.success ? 'ok' : 'falhou';
            const quando = l.createdAt.toLocaleString('pt-BR');
            return `- [${quando}] ${l.tool} (${status})`;
          })
          .join('\n');
        return `Operacoes recentes (${logs.length}):\n${lista}`;
      },
    });

    this.logger.log('Ferramentas de sistema registradas.');
  }
}
