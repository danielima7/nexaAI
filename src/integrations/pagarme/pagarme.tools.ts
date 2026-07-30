import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { PagarmeService } from './pagarme.service';

/**
 * Ferramentas do Pagar.me (multi-tenant). Cada execucao resolve a secret key
 * da organizacao (conta conectada da org ou fallback do .env).
 */
@Injectable()
export class PagarmeTools implements OnModuleInit {
  private readonly logger = new Logger(PagarmeTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly pagarme: PagarmeService,
    private readonly connections: ConnectionsService,
  ) {}

  private key(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(context, 'pagarme', 'PAGARME_SECRET_KEY');
  }

  private naoConectado(): string {
    return 'O Pagar.me ainda nao esta conectado para a sua organizacao.';
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'pagarme_listar_pedidos',
        description:
          'Lista os pedidos (orders) mais recentes no Pagar.me. Use quando o usuario pedir para ver pedidos/vendas do Pagar.me.',
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
        const orders = await this.pagarme.listOrders(key, input?.limite ?? 10);
        if (orders.length === 0) return 'Nenhum pedido encontrado no Pagar.me.';
        const lista = orders
          .map((o) => {
            const valor = this.pagarme.formatAmount(o.amount);
            const quem = o.customer?.name || o.customer?.email || 'sem cliente';
            return `- ${valor} (${o.status}) — ${quem}`;
          })
          .join('\n');
        return `Pedidos no Pagar.me (${orders.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'pagarme_listar_pagamentos',
        description:
          'Lista as cobrancas (charges) mais recentes no Pagar.me com valor e status. Use quando o usuario pedir para ver os pagamentos do Pagar.me.',
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
        const charges = await this.pagarme.listCharges(key, input?.limite ?? 10);
        if (charges.length === 0) return 'Nenhum pagamento encontrado no Pagar.me.';
        const lista = charges
          .map((c) => {
            const valor = this.pagarme.formatAmount(c.amount);
            const quem = c.customer?.name || c.customer?.email || 'sem cliente';
            return `- ${valor} (${c.status}) — ${quem}`;
          })
          .join('\n');
        return `Pagamentos no Pagar.me (${charges.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'pagarme_criar_cliente',
        description:
          'Cria um cliente no Pagar.me. Use quando o usuario pedir para cadastrar um cliente no Pagar.me.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome do cliente' },
            email: { type: 'string', description: 'E-mail (opcional)' },
            document: { type: 'string', description: 'CPF/CNPJ (opcional)' },
          },
          required: ['name'],
        },
      },
      escrita: true,
      execute: async (input, context) => {
        const key = await this.key(context);
        if (!key) return this.naoConectado();
        const customer = await this.pagarme.createCustomer(key, input);
        return `Cliente criado no Pagar.me com sucesso. ID: ${customer.id}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'pagarme_buscar_cliente',
        description:
          'Busca clientes no Pagar.me por e-mail. Use quando o usuario pedir para encontrar/consultar um cliente no Pagar.me.',
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
        const clientes = await this.pagarme.findCustomers(key, input.email);
        if (clientes.length === 0) return 'Nenhum cliente encontrado com esse e-mail.';
        const lista = clientes
          .map((c) => `- ${c.name || '(sem nome)'} <${c.email ?? ''}> (ID ${c.id})`)
          .join('\n');
        return `Clientes encontrados (${clientes.length}):\n${lista}`;
      },
    });

    this.logger.log('Ferramentas do Pagar.me registradas (multi-tenant).');
  }
}
