import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o Mercado Pago (pagamentos).
 *
 * Multi-tenant: cada metodo recebe o `token` (access token) da organizacao.
 * Apenas consultas (sem movimentar dinheiro).
 */
@Injectable()
export class MercadopagoService {
  private readonly logger = new Logger(MercadopagoService.name);
  private readonly baseUrl = 'https://api.mercadopago.com';

  private http(token: string): AxiosInstance {
    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Formata valor (ja em reais) para exibicao. */
  formatAmount(amount: number, currency = 'BRL'): string {
    const symbol = currency === 'BRL' ? 'R$' : currency;
    return `${symbol} ${Number(amount).toFixed(2)}`;
  }

  /** Busca pagamentos recentes (mais novos primeiro). */
  async searchPayments(
    token: string,
    params: { limit?: number; status?: string; days?: number },
  ): Promise<any[]> {
    const query: Record<string, any> = {
      sort: 'date_created',
      criteria: 'desc',
      limit: params.limit ?? 10,
    };
    if (params.status) query.status = params.status;
    if (params.days) {
      query.range = 'date_created';
      query.begin_date = `NOW-${params.days}DAYS`;
      query.end_date = 'NOW';
    }
    const { data } = await this.http(token).get('/v1/payments/search', {
      params: query,
    });
    return data?.results ?? [];
  }

  /** Detalha um pagamento pelo ID. */
  async getPayment(token: string, id: string): Promise<any> {
    const { data } = await this.http(token).get(`/v1/payments/${id}`);
    return data;
  }

  /** Soma o total aprovado (recebido) nos ultimos N dias. */
  async sumApproved(
    token: string,
    days = 30,
  ): Promise<{ total: number; currency: string; count: number }> {
    let offset = 0;
    const limit = 100;
    let total = 0;
    let count = 0;
    let currency = 'BRL';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await this.http(token).get('/v1/payments/search', {
        params: {
          status: 'approved',
          range: 'date_created',
          begin_date: `NOW-${days}DAYS`,
          end_date: 'NOW',
          limit,
          offset,
        },
      });
      const results = data?.results ?? [];
      for (const p of results) {
        total += Number(p.transaction_amount ?? 0);
        count += 1;
        if (p.currency_id) currency = p.currency_id;
      }
      const totalCount = data?.paging?.total ?? results.length;
      offset += limit;
      if (results.length < limit || offset >= totalCount) break;
    }
    return { total, currency, count };
  }
}
