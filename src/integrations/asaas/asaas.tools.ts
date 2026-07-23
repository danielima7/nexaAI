import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { AsaasService } from './asaas.service';

/**
 * Ferramentas do Asaas (multi-tenant). Cada execucao resolve a API key da
 * organizacao (conta conectada da org ou fallback do .env).
 */
@Injectable()
export class AsaasTools implements OnModuleInit {
  private readonly logger = new Logger(AsaasTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly asaas: AsaasService,
    private readonly connections: ConnectionsService,
  ) {}

  private key(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(context, 'asaas', 'ASAAS_API_KEY');
  }

  private naoConectado(): string {
    return 'O Asaas ainda nao esta conectado para a sua organizacao.';
  }

  private formatPayment(p: any): string {
    const valor = this.asaas.formatAmount(p.value);
    return `- ${valor} — vence ${p.dueDate ?? ''} — cliente ${p.customer ?? ''} (${p.status})`;
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'asaas_saldo',
        description:
          'Consulta o saldo da conta Asaas. Use quando o usuario perguntar sobre saldo no Asaas.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const saldo = await this.asaas.getBalance(key);
        return `Saldo Asaas: ${this.asaas.formatAmount(saldo)}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'asaas_cobrancas_vencidas',
        description:
          'Lista as cobrancas VENCIDAS (clientes inadimplentes) no Asaas. Use quando o usuario perguntar sobre inadimplentes ou cobrancas em atraso.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const cobrancas = await this.asaas.overduePayments(key);
        if (cobrancas.length === 0)
          return 'Nenhuma cobranca vencida (nenhum inadimplente). 🎉';
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
            dias: { type: 'number', description: 'Dias a frente (1 = ate amanha). Padrao 1.' },
          },
        },
      },
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const dias = input?.dias ?? 1;
        const cobrancas = await this.asaas.upcomingPayments(key, dias);
        if (cobrancas.length === 0)
          return `Nenhuma cobranca a vencer nos proximos ${dias} dia(s).`;
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
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const cliente = await this.asaas.createCustomer(key, input);
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
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const clientes = await this.asaas.findCustomers(key, input ?? {});
        if (clientes.length === 0) return 'Nenhum cliente encontrado no Asaas.';
        return `Clientes encontrados (${clientes.length}):\n${clientes
          .map((c) => `- ${c.name} (${c.cpfCnpj ?? 's/ documento'}) ID ${c.id}`)
          .join('\n')}`;
      },
    });

    this.logger.log('Ferramentas do Asaas registradas (multi-tenant).');
  }
}
