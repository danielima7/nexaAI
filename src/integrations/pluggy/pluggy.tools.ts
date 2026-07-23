import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { PluggyService } from './pluggy.service';

/**
 * Ferramentas do Pluggy (Open Finance / bancos), multi-tenant.
 * O clientId/secret sao globais (.env); o "item" (conexao bancaria) e por
 * organizacao (Connection provider='pluggy', credentials.itemId).
 */
@Injectable()
export class PluggyTools implements OnModuleInit {
  private readonly logger = new Logger(PluggyTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly pluggy: PluggyService,
    private readonly connections: ConnectionsService,
    private readonly config: ConfigService,
  ) {}

  /** Retorna o itemId (conexao bancaria) da organizacao, se houver. */
  private async itemId(context?: ToolContext): Promise<string | undefined> {
    if (!context?.organizationId) return undefined;
    const conn = await this.connections.get(context.organizationId, 'pluggy');
    return (conn?.credentials as any)?.itemId;
  }

  private semBanco(): string {
    return 'Nenhum banco conectado para a sua organizacao. Peca para conectar um banco de teste primeiro.';
  }

  private formatMoney(value: number, currency = 'BRL'): string {
    const symbol = currency === 'BRL' ? 'R$' : currency;
    return `${symbol} ${Number(value ?? 0).toFixed(2)}`;
  }

  onModuleInit(): void {
    if (!this.pluggy.isConfigured()) {
      this.logger.warn(
        'Pluggy nao configurado (client id/secret) — ferramentas do Pluggy nao registradas.',
      );
      return;
    }

    this.registry.register({
      definition: {
        name: 'kyrius_conectar_banco',
        description:
          'Gera o link para o usuario conectar um BANCO REAL via Open Finance (widget Pluggy Connect, com consentimento no proprio banco). Use quando o usuario pedir para conectar o banco dele / uma conta bancaria real.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        if (!context?.organizationId)
          return 'Nao consegui identificar sua organizacao.';
        const base = this.config.get<string>('PUBLIC_BASE_URL') ?? '';
        const url = `${base}/pluggy/connect?org=${context.organizationId}`;
        return `Para conectar seu banco, abra este link no navegador, escolha seu banco e autorize (consentimento do Open Finance):\n${url}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'kyrius_conectar_banco_teste',
        description:
          'Conecta um banco de TESTE (sandbox do Pluggy) para a organizacao, permitindo consultar contas, saldos e transacoes. Use quando o usuario pedir para conectar um banco de teste / Open Finance.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        if (!context?.organizationId)
          return 'Nao consegui identificar sua organizacao.';
        const item = await this.pluggy.createSandboxItem();
        await this.connections.set(context.organizationId, 'pluggy', {
          itemId: item.id,
        });
        return `Banco de teste conectado (item ${item.id}). A sincronizacao leva alguns segundos — depois consulte contas, saldo ou transacoes.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'pluggy_contas',
        description:
          'Lista as contas bancarias conectadas (via Open Finance/Pluggy) com seus saldos. Use quando o usuario pedir para ver contas do banco.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        const itemId = await this.itemId(context);
        if (!itemId) return this.semBanco();
        const contas = await this.pluggy.listAccounts(itemId);
        if (contas.length === 0)
          return 'Nenhuma conta encontrada ainda (a conexao pode estar sincronizando — tente de novo em instantes).';
        const lista = contas
          .map(
            (a) =>
              `- ${a.name ?? a.type} (${a.type}): ${this.formatMoney(a.balance, a.currencyCode)}`,
          )
          .join('\n');
        return `Contas bancarias (${contas.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'pluggy_saldo_total',
        description:
          'Soma o saldo de todas as contas bancarias conectadas (via Open Finance/Pluggy). Use quando o usuario perguntar o saldo bancario total.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        const itemId = await this.itemId(context);
        if (!itemId) return this.semBanco();
        const contas = await this.pluggy.listAccounts(itemId);
        if (contas.length === 0)
          return 'Nenhuma conta encontrada ainda (pode estar sincronizando).';
        const total = contas.reduce((s, a) => s + Number(a.balance ?? 0), 0);
        const currency = contas[0]?.currencyCode ?? 'BRL';
        return `Saldo bancario total: ${this.formatMoney(total, currency)} (em ${contas.length} conta(s)).`;
      },
    });

    this.registry.register({
      definition: {
        name: 'pluggy_transacoes',
        description:
          'Lista as transacoes bancarias recentes (via Open Finance/Pluggy). Use quando o usuario pedir para ver o extrato ou as ultimas movimentacoes.',
        input_schema: {
          type: 'object',
          properties: {
            limite: { type: 'number', description: 'Quantas transacoes (padrao 15)' },
          },
        },
      },
      execute: async (input, context) => {
        const itemId = await this.itemId(context);
        if (!itemId) return this.semBanco();
        const contas = await this.pluggy.listAccounts(itemId);
        if (contas.length === 0)
          return 'Nenhuma conta encontrada ainda (pode estar sincronizando).';
        const trans = await this.pluggy.listTransactions(
          contas[0].id,
          input?.limite ?? 15,
        );
        if (trans.length === 0) return 'Nenhuma transacao encontrada.';
        const lista = trans
          .map((t) => {
            const valor = this.formatMoney(t.amount, t.currencyCode);
            const data = (t.date ?? '').slice(0, 10);
            return `- ${data} ${valor} — ${t.description ?? ''}`;
          })
          .join('\n');
        return `Ultimas transacoes (${trans.length}):\n${lista}`;
      },
    });

    this.logger.log('Ferramentas do Pluggy (Open Finance) registradas (multi-tenant).');
  }
}
