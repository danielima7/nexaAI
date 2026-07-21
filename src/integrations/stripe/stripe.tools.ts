import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { StripeService } from './stripe.service';

/**
 * Registra as ferramentas do Stripe no ToolRegistry na inicializacao.
 * Apenas consultas e cadastro de cliente (sem movimentacao de dinheiro).
 */
@Injectable()
export class StripeTools implements OnModuleInit {
  private readonly logger = new Logger(StripeTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly stripe: StripeService,
  ) {}

  onModuleInit(): void {
    if (!this.stripe.isConfigured()) {
      this.logger.warn(
        'STRIPE_SECRET_KEY nao configurado — ferramentas do Stripe nao registradas.',
      );
      return;
    }

    this.registry.register({
      definition: {
        name: 'stripe_saldo',
        description:
          'Consulta o saldo da conta Stripe (disponivel e pendente). Use quando o usuario perguntar sobre saldo no Stripe.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async () => {
        const balance = await this.stripe.getBalance();
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
            limite: {
              type: 'number',
              description: 'Quantidade de pagamentos a listar (padrao 10)',
            },
          },
        },
      },
      execute: async (input) => {
        const charges = await this.stripe.listCharges(input?.limite ?? 10);
        if (charges.length === 0) {
          return 'Nenhum pagamento encontrado no Stripe.';
        }
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
          'Soma o total recebido no Stripe em um periodo (ex: hoje, ultimos 7/30 dias). Use quando o usuario perguntar "quanto entrou/recebemos no Stripe".',
        input_schema: {
          type: 'object',
          properties: {
            dias: {
              type: 'number',
              description: 'Numero de dias para somar (ex: 1 = hoje, 7, 30). Padrao 30.',
            },
          },
        },
      },
      execute: async (input) => {
        const dias = input?.dias ?? 30;
        const { total, currency, count } = await this.stripe.sumReceived(dias);
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
            email: { type: 'string', description: 'E-mail do cliente (opcional)' },
          },
          required: ['name'],
        },
      },
      execute: async (input) => {
        const customer = await this.stripe.createCustomer(input);
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
      execute: async (input) => {
        const customers = await this.stripe.findCustomersByEmail(input.email);
        if (customers.length === 0) {
          return 'Nenhum cliente encontrado com esse e-mail.';
        }
        const lista = customers
          .map((c) => `- ${c.name || '(sem nome)'} <${c.email}> (ID ${c.id})`)
          .join('\n');
        return `Clientes encontrados (${customers.length}):\n${lista}`;
      },
    });

    this.logger.log('Ferramentas do Stripe registradas.');
  }
}
