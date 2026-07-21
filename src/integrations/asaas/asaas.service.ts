import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o Asaas (financeiro/cobrancas BR).
 *
 * Consultas (saldo, cobrancas vencidas/a vencer) + cadastro de cliente.
 * Sem operacoes que movimentam dinheiro (nao cria cobrancas/transferencias).
 * Autenticacao: header `access_token` (padrao do Asaas, nao e Bearer).
 */
@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);

  constructor(private readonly config: ConfigService) {}

  /** A chave esta configurada no .env? */
  isConfigured(): boolean {
    const key = this.config.get<string>('ASAAS_API_KEY');
    return !!key && key !== 'COLE_AQUI_A_CHAVE_DO_ASAAS';
  }

  /** Cliente HTTP autenticado para o Asaas. */
  private http(): AxiosInstance {
    const key = this.config.get<string>('ASAAS_API_KEY');
    const baseURL =
      this.config.get<string>('ASAAS_BASE_URL') ??
      'https://sandbox.asaas.com/api/v3';
    return axios.create({
      baseURL,
      headers: {
        access_token: key as string,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Formata valor (em reais) para exibicao. */
  formatAmount(value: number): string {
    return `R$ ${Number(value ?? 0).toFixed(2)}`;
  }

  /** Data de hoje + N dias no formato YYYY-MM-DD. */
  private dateOffset(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** Saldo da conta Asaas. */
  async getBalance(): Promise<number> {
    const { data } = await this.http().get('/finance/balance');
    return data?.balance ?? 0;
  }

  /** Lista cobrancas por status (ex: OVERDUE, PENDING, RECEIVED). */
  async listPayments(params: {
    status?: string;
    dueDateLe?: string;
    dueDateGe?: string;
    limit?: number;
  }): Promise<any[]> {
    const query: Record<string, any> = { limit: params.limit ?? 20 };
    if (params.status) query.status = params.status;
    if (params.dueDateLe) query['dueDate[le]'] = params.dueDateLe;
    if (params.dueDateGe) query['dueDate[ge]'] = params.dueDateGe;
    const { data } = await this.http().get('/payments', { params: query });
    return data?.data ?? [];
  }

  /** Cobrancas vencidas (inadimplentes). */
  async overduePayments(limit = 20): Promise<any[]> {
    return this.listPayments({ status: 'OVERDUE', limit });
  }

  /** Cobrancas a vencer nos proximos N dias (padrao 1 = ate amanha). */
  async upcomingPayments(days = 1, limit = 20): Promise<any[]> {
    return this.listPayments({
      status: 'PENDING',
      dueDateGe: this.dateOffset(0),
      dueDateLe: this.dateOffset(days),
      limit,
    });
  }

  /** Cria um cliente. cpfCnpj e obrigatorio no Asaas. */
  async createCustomer(params: {
    name: string;
    cpfCnpj: string;
    email?: string;
    mobilePhone?: string;
  }): Promise<any> {
    const { data } = await this.http().post('/customers', params);
    return data;
  }

  /** Busca clientes por nome ou e-mail. */
  async findCustomers(params: { name?: string; email?: string }): Promise<any[]> {
    const { data } = await this.http().get('/customers', {
      params: { ...params, limit: 10 },
    });
    return data?.data ?? [];
  }
}
