import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { StripeService } from './stripe.service';

/**
 * Ferramentas do Stripe (multi-tenant). Cada execucao resolve a secret key
 * da organizacao (conta conectada da org ou fallback do .env).
 */
@Injectable()
export class StripeTools implements OnModuleInit {
  private readonly logger = new Logger(StripeTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly stripe: StripeService,
    private readonly connections: ConnectionsService,
  ) {}

  private key(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(context, 'stripe', 'STRIPE_SECRET_KEY');
  }

  private naoConectado(): string {
    return 'O Stripe ainda nao esta conectado para a sua organizacao.';
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'stripe_saldo',
        description:
          'Consulta o saldo da conta Stripe (disponivel e pendente). Use quando o usuario perguntar sobre saldo no Stripe.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const balance = await this.stripe.getBalance(key);
        const fmt = (arr: { amount: number; currency: string }[]) =>
          arr.length
            ? arr.map((b) => this.stripe.formatAmount(b.amount, b.currency)).join(', ')
            : 'R$ 0.00';
        return `Saldo Stripe — disponivel: ${fmt(balance.available)}; pendente: ${fmt(balance.pending)}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'stripe_listar_pagamentos',
        description:
          'Lista os pagamentos mais recentes recebidos no Stripe (valor, status, cliente). Use quando o usuario pedir para ver os ultimos pagamentos/vendas no Stripe.',
        input_schema: {
          type: 'object',
          properties: {
            limite: { type: 'number', description: 'Quantidade (padrao 10)' },
          },
        },
      },
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const charges = await this.stripe.listCharges(key, input?.limite ?? 10);
        if (charges.length === 0) return 'Nenhum pagamento encontrado no Stripe.';
        const lista = charges
          .map((c) => {
            const valor = this.stripe.formatAmount(c.amount, c.currency);
            const quem = c.billing_details?.name || c.receipt_email || 'sem nome';
            const status = c.status === 'succeeded' ? 'pago' : c.status;
            return `- ${valor} (${status}) — ${quem}`;
          })
          .join('\n');
        return `Ultimos pagamentos (${charges.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'stripe_total_recebido',
        description:
          'Soma o total recebido no Stripe em um periodo. Use quando o usuario perguntar "quanto entrou/recebemos no Stripe".',
        input_schema: {
          type: 'object',
          properties: {
            dias: { type: 'number', description: 'Numero de dias (padrao 30)' },
          },
        },
      },
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const dias = input?.dias ?? 30;
        const { total, currency, count } = await this.stripe.sumReceived(key, dias);
        const valor = this.stripe.formatAmount(total, currency);
        return `Nos ultimos ${dias} dia(s): ${valor} recebidos em ${count} pagamento(s).`;
      },
    });

    this.registry.register({
      definition: {
        name: 'stripe_criar_cliente',
        description:
          'Cria um cliente no Stripe. Use quando o usuario pedir para cadastrar um cliente no Stripe.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome do cliente' },
            email: { type: 'string', description: 'E-mail (opcional)' },
          },
          required: ['name'],
        },
      },
      escrita: true,
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const customer = await this.stripe.createCustomer(key, input);
        return `Cliente criado no Stripe com sucesso. ID: ${customer.id}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'stripe_buscar_cliente',
        description:
          'Busca clientes no Stripe por e-mail. Use quando o usuario pedir para encontrar/consultar um cliente no Stripe.',
        input_schema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'E-mail do cliente a buscar' },
          },
          required: ['email'],
        },
      },
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const customers = await this.stripe.findCustomersByEmail(key, input.email);
        if (customers.length === 0) return 'Nenhum cliente encontrado com esse e-mail.';
        const lista = customers
          .map((c) => `- ${c.name || '(sem nome)'} <${c.email}> (ID ${c.id})`)
          .join('\n');
        return `Clientes encontrados (${customers.length}):\n${lista}`;
      },
    });

    this.logger.log('Ferramentas do Stripe registradas (multi-tenant).');
  }
}
