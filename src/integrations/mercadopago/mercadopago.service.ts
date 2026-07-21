import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o Mercado Pago (pagamentos).
 *
 * Apenas operacoes de CONSULTA (listar pagamentos, somar recebido, detalhar).
 * Sem operacoes que movimentam dinheiro, por seguranca.
 */
@Injectable()
export class MercadopagoService {
  private readonly logger = new Logger(MercadopagoService.name);
  private readonly baseUrl = 'https://api.mercadopago.com';

  constructor(private readonly config: ConfigService) {}

  /** O token esta configurado no .env? */
  isConfigured(): boolean {
    const token = this.config.get<string>('MERCADOPAGO_ACCESS_TOKEN');
    return !!token && token !== 'COLE_AQUI_O_ACCESS_TOKEN_DE_TESTE';
  }

  /** Cliente HTTP autenticado. */
  private http(): AxiosInstance {
    const token = this.config.get<string>('MERCADOPAGO_ACCESS_TOKEN');
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
  async searchPayments(params: {
    limit?: number;
    status?: string;
    days?: number;
  }): Promise<any[]> {
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
    const { data } = await this.http().get('/v1/payments/search', {
      params: query,
    });
    return data?.results ?? [];
  }

  /** Detalha um pagamento pelo ID. */
  async getPayment(id: string): Promise<any> {
    const { data } = await this.http().get(`/v1/payments/${id}`);
    return data;
  }

  /**
   * Soma o total aprovado (recebido) nos ultimos N dias, paginando os
   * resultados.
   */
  async sumApproved(days = 30): Promise<{ total: number; currency: string; count: number }> {
    let offset = 0;
    const limit = 100;
    let total = 0;
    let count = 0;
    let currency = 'BRL';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await this.http().get('/v1/payments/search', {
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
