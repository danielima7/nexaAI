import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { MercadopagoService } from './mercadopago.service';

/**
 * Ferramentas do Mercado Pago (multi-tenant). Cada execucao resolve o access
 * token da organizacao (conta conectada da org ou fallback do .env).
 */
@Injectable()
export class MercadopagoTools implements OnModuleInit {
  private readonly logger = new Logger(MercadopagoTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly mp: MercadopagoService,
    private readonly connections: ConnectionsService,
  ) {}

  private token(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(
      context,
      'mercadopago',
      'MERCADOPAGO_ACCESS_TOKEN',
    );
  }

  private naoConectado(): string {
    return 'O Mercado Pago ainda nao esta conectado para a sua organizacao.';
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'mercadopago_listar_pagamentos',
        description:
          'Lista os pagamentos mais recentes no Mercado Pago (valor, status, pagador). Use quando o usuario pedir para ver os ultimos pagamentos do Mercado Pago.',
        input_schema: {
          type: 'object',
          properties: {
            limite: { type: 'number', description: 'Quantidade (padrao 10)' },
          },
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const results = await this.mp.searchPayments(token, {
          limit: input?.limite ?? 10,
        });
        if (results.length === 0)
          return 'Nenhum pagamento encontrado no Mercado Pago.';
        const lista = results
          .map((p) => {
            const valor = this.mp.formatAmount(p.transaction_amount, p.currency_id);
            const quem = p.payer?.email || 'sem identificacao';
            return `- ${valor} (${p.status}) — ${quem}`;
          })
          .join('\n');
        return `Ultimos pagamentos no Mercado Pago (${results.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'mercadopago_total_recebido',
        description:
          'Soma o total aprovado (recebido) no Mercado Pago em um periodo. Use quando o usuario perguntar "quanto entrou no Mercado Pago".',
        input_schema: {
          type: 'object',
          properties: {
            dias: { type: 'number', description: 'Numero de dias (padrao 30)' },
          },
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const dias = input?.dias ?? 30;
        const { total, currency, count } = await this.mp.sumApproved(token, dias);
        const valor = this.mp.formatAmount(total, currency);
        return `Nos ultimos ${dias} dia(s): ${valor} recebidos em ${count} pagamento(s) aprovado(s) no Mercado Pago.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'mercadopago_detalhar_pagamento',
        description:
          'Mostra os detalhes de um pagamento especifico do Mercado Pago pelo ID.',
        input_schema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ID do pagamento' },
          },
          required: ['id'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const p = await this.mp.getPayment(token, input.id);
        const valor = this.mp.formatAmount(p.transaction_amount, p.currency_id);
        return [
          `Pagamento ${p.id}:`,
          `- Valor: ${valor}`,
          `- Status: ${p.status}`,
          `- Descricao: ${p.description ?? '(sem descricao)'}`,
          `- Pagador: ${p.payer?.email ?? 'sem identificacao'}`,
          `- Data: ${p.date_created}`,
        ].join('\n');
      },
    });

    this.logger.log('Ferramentas do Mercado Pago registradas (multi-tenant).');
  }
}
