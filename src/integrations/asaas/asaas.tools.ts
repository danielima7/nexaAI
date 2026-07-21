import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { AsaasService } from './asaas.service';

/**
 * Registra as ferramentas do Asaas no ToolRegistry.
 * Consultas financeiras + cadastro de cliente (sem movimentar dinheiro).
 */
@Injectable()
export class AsaasTools implements OnModuleInit {
  private readonly logger = new Logger(AsaasTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly asaas: AsaasService,
  ) {}

  private formatPayment(p: any): string {
    const valor = this.asaas.formatAmount(p.value);
    const venc = p.dueDate ?? '';
    const cliente = p.customer ?? '';
    return `- ${valor} — vence ${venc} — cliente ${cliente} (${p.status})`;
  }

  onModuleInit(): void {
    if (!this.asaas.isConfigured()) {
      this.logger.warn(
        'ASAAS_API_KEY nao configurado — ferramentas do Asaas nao registradas.',
      );
      return;
    }

    this.registry.register({
      definition: {
        name: 'asaas_saldo',
        description:
          'Consulta o saldo da conta Asaas. Use quando o usuario perguntar sobre saldo no Asaas.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async () => {
        const saldo = await this.asaas.getBalance();
        return `Saldo Asaas: ${this.asaas.formatAmount(saldo)}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'asaas_cobrancas_vencidas',
        description:
          'Lista as cobrancas VENCIDAS (clientes inadimplentes) no Asaas. Use quando o usuario perguntar sobre inadimplentes, cobrancas vencidas ou em atraso.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async () => {
        const cobrancas = await this.asaas.overduePayments();
        if (cobrancas.length === 0) {
          return 'Nenhuma cobranca vencida (nenhum inadimplente). 🎉';
        }
        return `Cobrancas vencidas (${cobrancas.length}):\n${cobrancas
          .map((p) => this.formatPayment(p))
          .join('\n')}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'asaas_cobrancas_a_vencer',
        description:
          'Lista as cobrancas/boletos a vencer nos proximos dias no Asaas. Use quando o usuario perguntar quais boletos vencem hoje/amanha/em breve.',
        input_schema: {
          type: 'object',
          properties: {
            dias: {
              type: 'number',
              description: 'Numero de dias a frente (1 = ate amanha). Padrao 1.',
            },
          },
        },
      },
      execute: async (input) => {
        const dias = input?.dias ?? 1;
        const cobrancas = await this.asaas.upcomingPayments(dias);
        if (cobrancas.length === 0) {
          return `Nenhuma cobranca a vencer nos proximos ${dias} dia(s).`;
        }
        return `Cobrancas a vencer em ${dias} dia(s) (${cobrancas.length}):\n${cobrancas
          .map((p) => this.formatPayment(p))
          .join('\n')}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'asaas_criar_cliente',
        description:
          'Cadastra um cliente no Asaas. Exige nome e CPF/CNPJ. Use quando o usuario pedir para cadastrar um cliente no Asaas.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome do cliente' },
            cpfCnpj: { type: 'string', description: 'CPF ou CNPJ (obrigatorio)' },
            email: { type: 'string', description: 'E-mail (opcional)' },
            mobilePhone: { type: 'string', description: 'Celular (opcional)' },
          },
          required: ['name', 'cpfCnpj'],
        },
      },
      execute: async (input) => {
        const cliente = await this.asaas.createCustomer(input);
        return `Cliente cadastrado no Asaas com sucesso. ID: ${cliente.id}, nome: ${cliente.name}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'asaas_buscar_cliente',
        description:
          'Busca clientes no Asaas por nome ou e-mail. Use quando o usuario pedir para encontrar/consultar um cliente no Asaas.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome a buscar (opcional)' },
            email: { type: 'string', description: 'E-mail a buscar (opcional)' },
          },
        },
      },
      execute: async (input) => {
        const clientes = await this.asaas.findCustomers(input ?? {});
        if (clientes.length === 0) {
          return 'Nenhum cliente encontrado no Asaas.';
        }
        return `Clientes encontrados (${clientes.length}):\n${clientes
          .map((c) => `- ${c.name} (${c.cpfCnpj ?? 's/ documento'}) ID ${c.id}`)
          .join('\n')}`;
      },
    });

    this.logger.log('Ferramentas do Asaas registradas.');
  }
}
