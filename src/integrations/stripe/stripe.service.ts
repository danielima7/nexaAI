import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

/**
 * Service da integracao com o Stripe (pagamentos).
 *
 * Multi-tenant: cada metodo recebe a `key` (secret key) da organizacao.
 * Apenas consultas e cadastro de cliente (sem movimentar dinheiro).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  /** Cliente Stripe construido a partir da secret key informada. */
  private client(key: string): Stripe {
    return new Stripe(key);
  }

  /** Formata um valor (em centavos) para exibicao. */
  formatAmount(amountInCents: number, currency: string): string {
    const value = (amountInCents / 100).toFixed(2);
    const symbol =
      currency?.toLowerCase() === 'brl' ? 'R$' : currency?.toUpperCase();
    return `${symbol} ${value}`;
  }

  /** Saldo da conta (disponivel e pendente). */
  async getBalance(key: string): Promise<Stripe.Balance> {
    return this.client(key).balance.retrieve();
  }

  /** Lista os pagamentos (charges) mais recentes. */
  async listCharges(key: string, limit = 10): Promise<Stripe.Charge[]> {
    const res = await this.client(key).charges.list({ limit });
    return res.data;
  }

  /** Soma o total recebido (charges pagos) nos ultimos N dias. */
  async sumReceived(
    key: string,
    days = 30,
  ): Promise<{ total: number; currency: string; count: number }> {
    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    let total = 0;
    let count = 0;
    let currency = 'brl';
    const params: Stripe.ChargeListParams = { limit: 100, created: { gte: since } };
    for await (const charge of this.client(key).charges.list(params)) {
      if (charge.paid && charge.status === 'succeeded') {
        total += charge.amount;
        count += 1;
        currency = charge.currency;
      }
    }
    return { total, currency, count };
  }

  /** Cria um cliente. */
  async createCustomer(
    key: string,
    params: { name: string; email?: string },
  ): Promise<Stripe.Customer> {
    return this.client(key).customers.create(params);
  }

  /** Busca clientes por e-mail. */
  async findCustomersByEmail(
    key: string,
    email: string,
  ): Promise<Stripe.Customer[]> {
    const res = await this.client(key).customers.list({ email, limit: 10 });
    return res.data;
  }
}
