import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ferramentas "de sistema" do proprio Kyrius (nao ligadas a uma integracao
 * externa). Ex: consultar o historico de operacoes que a IA executou.
 */
@Injectable()
export class SystemTools implements OnModuleInit {
  private readonly logger = new Logger(SystemTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
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
