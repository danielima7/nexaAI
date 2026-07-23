import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o Asaas (financeiro/cobrancas BR).
 *
 * Multi-tenant: cada metodo recebe a `key` (API key) da organizacao.
 * A base da API (sandbox/producao) vem do .env (global) por enquanto.
 * Auth: header `access_token` (padrao do Asaas).
 */
@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);

  constructor(private readonly config: ConfigService) {}

  private http(key: string): AxiosInstance {
    const baseURL =
      this.config.get<string>('ASAAS_BASE_URL') ??
      'https://sandbox.asaas.com/api/v3';
    return axios.create({
      baseURL,
      headers: { access_token: key, 'Content-Type': 'application/json' },
    });
  }

  formatAmount(value: number): string {
    return `R$ ${Number(value ?? 0).toFixed(2)}`;
  }

  private dateOffset(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async getBalance(key: string): Promise<number> {
    const { data } = await this.http(key).get('/finance/balance');
    return data?.balance ?? 0;
  }

  async listPayments(
    key: string,
    params: { status?: string; dueDateLe?: string; dueDateGe?: string; limit?: number },
  ): Promise<any[]> {
    const query: Record<string, any> = { limit: params.limit ?? 20 };
    if (params.status) query.status = params.status;
    if (params.dueDateLe) query['dueDate[le]'] = params.dueDateLe;
    if (params.dueDateGe) query['dueDate[ge]'] = params.dueDateGe;
    const { data } = await this.http(key).get('/payments', { params: query });
    return data?.data ?? [];
  }

  async overduePayments(key: string, limit = 20): Promise<any[]> {
    return this.listPayments(key, { status: 'OVERDUE', limit });
  }

  async upcomingPayments(key: string, days = 1, limit = 20): Promise<any[]> {
    return this.listPayments(key, {
      status: 'PENDING',
      dueDateGe: this.dateOffset(0),
      dueDateLe: this.dateOffset(days),
      limit,
    });
  }

  async createCustomer(
    key: string,
    params: { name: string; cpfCnpj: string; email?: string; mobilePhone?: string },
  ): Promise<any> {
    const { data } = await this.http(key).post('/customers', params);
    return data;
  }

  async findCustomers(
    key: string,
    params: { name?: string; email?: string },
  ): Promise<any[]> {
    const { data } = await this.http(key).get('/customers', {
      params: { ...params, limit: 10 },
    });
    return data?.data ?? [];
  }
}
