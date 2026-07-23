import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o Pagar.me (grupo Stone, pagamentos) — API v5.
 *
 * Multi-tenant: cada metodo recebe a `key` (secret key sk_...) da organizacao.
 * Auth: Basic com a secret key como usuario e senha vazia.
 * Apenas consultas + cadastro de cliente (sem movimentar dinheiro).
 */
@Injectable()
export class PagarmeService {
  private readonly logger = new Logger(PagarmeService.name);
  private readonly baseUrl = 'https://api.pagar.me/core/v5';

  private http(key: string): AxiosInstance {
    const basic = Buffer.from(`${key}:`).toString('base64');
    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Formata valor (em centavos) para exibicao. */
  formatAmount(amountInCents: number): string {
    return `R$ ${(Number(amountInCents ?? 0) / 100).toFixed(2)}`;
  }

  /** Lista pedidos recentes. */
  async listOrders(key: string, size = 10): Promise<any[]> {
    const { data } = await this.http(key).get('/orders', { params: { size } });
    return data?.data ?? [];
  }

  /** Lista cobrancas (charges) recentes. */
  async listCharges(key: string, size = 10): Promise<any[]> {
    const { data } = await this.http(key).get('/charges', { params: { size } });
    return data?.data ?? [];
  }

  /** Cria um cliente. */
  async createCustomer(
    key: string,
    params: { name: string; email?: string; document?: string },
  ): Promise<any> {
    const { data } = await this.http(key).post('/customers', params);
    return data;
  }

  /** Busca clientes (opcionalmente filtrando por e-mail). */
  async findCustomers(key: string, email?: string): Promise<any[]> {
    const { data } = await this.http(key).get('/customers', {
      params: { size: 20 },
    });
    const list = data?.data ?? [];
    if (!email) return list.slice(0, 10);
    return list.filter((c: any) => (c.email ?? '').toLowerCase() === email.toLowerCase());
  }
}
