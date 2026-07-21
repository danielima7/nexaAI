import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Service da integracao com o Stripe (pagamentos).
 *
 * Expoe apenas operacoes de CONSULTA e cadastro de cliente. Por seguranca,
 * NAO ha operacoes que movimentam dinheiro (cobrancas, reembolsos,
 * transferencias) — isso deve ser feito pelo usuario diretamente.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null = null;

  constructor(private readonly config: ConfigService) {}

  /** A chave esta configurada no .env? */
  isConfigured(): boolean {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    return !!key && key.startsWith('sk_');
  }

  /** Cliente Stripe (criado sob demanda). */
  private stripe(): Stripe {
    if (!this.client) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY') as string;
      this.client = new Stripe(key);
    }
    return this.client;
  }

  /** Formata um valor (em centavos) para exibicao. Ex: 25000, 'brl' -> "R$ 250.00". */
  formatAmount(amountInCents: number, currency: string): string {
    const value = (amountInCents / 100).toFixed(2);
    const symbol = currency?.toLowerCase() === 'brl' ? 'R$' : currency?.toUpperCase();
    return `${symbol} ${value}`;
  }

  /** Saldo da conta (disponivel e pendente). */
  async getBalance(): Promise<Stripe.Balance> {
    return this.stripe().balance.retrieve();
  }

  /** Lista os pagamentos (charges) mais recentes. */
  async listCharges(limit = 10): Promise<Stripe.Charge[]> {
    const res = await this.stripe().charges.list({ limit });
    return res.data;
  }

  /**
   * Soma o total recebido (charges pagos) nos ultimos N dias.
   * @returns { total (centavos), currency, count }
   */
  async sumReceived(days = 30): Promise<{ total: number; currency: string; count: number }> {
    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    let total = 0;
    let count = 0;
    let currency = 'brl';

    // Percorre paginas de charges pagos no periodo.
    const params: Stripe.ChargeListParams = {
      limit: 100,
      created: { gte: since },
    };
    for await (const charge of this.stripe().charges.list(params)) {
      if (charge.paid && charge.status === 'succeeded') {
        total += charge.amount;
        count += 1;
        currency = charge.currency;
      }
    }
    return { total, currency, count };
  }

  /** Cria um cliente. */
  async createCustomer(params: { name: string; email?: string }): Promise<Stripe.Customer> {
    return this.stripe().customers.create(params);
  }

  /** Busca clientes por e-mail. */
  async findCustomersByEmail(email: string): Promise<Stripe.Customer[]> {
    const res = await this.stripe().customers.list({ email, limit: 10 });
    return res.data;
  }
}
