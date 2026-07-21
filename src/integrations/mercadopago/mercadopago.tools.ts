import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { MercadopagoService } from './mercadopago.service';

/**
 * Registra as ferramentas do Mercado Pago no ToolRegistry.
 * Apenas consultas (sem movimentacao de dinheiro).
 */
@Injectable()
export class MercadopagoTools implements OnModuleInit {
  private readonly logger = new Logger(MercadopagoTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly mp: MercadopagoService,
  ) {}

  onModuleInit(): void {
    if (!this.mp.isConfigured()) {
      this.logger.warn(
        'MERCADOPAGO_ACCESS_TOKEN nao configurado — ferramentas do Mercado Pago nao registradas.',
      );
      return;
    }

    this.registry.register({
      definition: {
        name: 'mercadopago_listar_pagamentos',
        description:
          'Lista os pagamentos mais recentes no Mercado Pago (valor, status, pagador). Use quando o usuario pedir para ver os ultimos pagamentos/vendas do Mercado Pago.',
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
        const results = await this.mp.searchPayments({ limit: input?.limite ?? 10 });
        if (results.length === 0) {
          return 'Nenhum pagamento encontrado no Mercado Pago.';
        }
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
          'Soma o total aprovado (recebido) no Mercado Pago em um periodo. Use quando o usuario perguntar "quanto entrou/recebemos no Mercado Pago".',
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
        const { total, currency, count } = await this.mp.sumApproved(dias);
        const valor = this.mp.formatAmount(total, currency);
        return `Nos ultimos ${dias} dia(s): ${valor} recebidos em ${count} pagamento(s) aprovado(s) no Mercado Pago.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'mercadopago_detalhar_pagamento',
        description:
          'Mostra os detalhes de um pagamento especifico do Mercado Pago pelo ID. Use quando o usuario informar o ID de um pagamento e pedir detalhes.',
        input_schema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ID do pagamento no Mercado Pago' },
          },
          required: ['id'],
        },
      },
      execute: async (input) => {
        const p = await this.mp.getPayment(input.id);
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

    this.logger.log('Ferramentas do Mercado Pago registradas.');
  }
}
