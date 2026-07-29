import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolRegistryService } from './tool-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { PROVEDORES } from '../connections/provider-catalog';

/**
 * Ferramentas "de sistema" do proprio Kyrius (nao ligadas a uma integracao
 * externa): historico de operacoes e conexao de integracoes por organizacao.
 */
@Injectable()
export class SystemTools implements OnModuleInit {
  private readonly logger = new Logger(SystemTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly config: ConfigService,
  ) {}

  /** Link da tela onde o cliente conecta as proprias contas. */
  private linkIntegracoes(): string {
    const base = (
      this.config.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/integracoes`;
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'kyrius_conectar_integracao',
        description:
          'Devolve o link da pagina segura onde o usuario conecta as proprias integracoes (HubSpot, Stripe, Asaas, Mercado Pago, Pagar.me, Google, Instagram e contas bancarias). Use SEMPRE que o usuario pedir para conectar ou configurar uma integracao. NUNCA peca a chave de API ou token pela conversa — credenciais so devem ser informadas nessa pagina.',
        input_schema: {
          type: 'object',
          properties: {
            provedor: {
              type: 'string',
              description:
                'Opcional. Integracao que o usuario quer conectar, para orienta-lo melhor.',
            },
          },
        },
      },
      execute: async (input, context) => {
        if (!context?.organizationId)
          return 'Nao consegui identificar sua organizacao.';

        const pedido = String(input?.provedor ?? '')
          .toLowerCase()
          .trim();
        const provedor = pedido
          ? PROVEDORES.find(
              (p) => p.id === pedido || p.nome.toLowerCase().includes(pedido),
            )
          : undefined;

        const linhas = [
          'Para conectar com seguranca, abra esta pagina e faca a conexao por la:',
          this.linkIntegracoes(),
        ];

        if (pedido && provedor) {
          linhas.push('', `Sobre ${provedor.nome}: ${provedor.ajuda}`);
        } else if (pedido && !provedor) {
          linhas.push(
            '',
            `Ainda nao ha integracao com "${input.provedor}". Disponiveis: ${PROVEDORES.map((p) => p.nome).join(', ')}.`,
          );
        }

        linhas.push(
          '',
          'Importante: nunca envie chaves de API ou senhas por aqui — a conversa fica salva. Use sempre a pagina.',
        );

        return linhas.join('\n');
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
        const nomes = providers.map(
          (id) => PROVEDORES.find((p) => p.id === id)?.nome ?? id,
        );

        if (nomes.length === 0) {
          return [
            'Sua organizacao ainda nao conectou nenhuma integracao.',
            `Voce pode conectar em: ${this.linkIntegracoes()}`,
          ].join('\n');
        }

        return [
          `Integracoes conectadas: ${nomes.join(', ')}.`,
          `Para conectar outras ou trocar credenciais: ${this.linkIntegracoes()}`,
        ].join('\n');
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
