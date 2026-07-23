import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o Pluggy (agregador de Open Finance / bancos).
 *
 * Modelo: o Kyrius tem UMA aplicacao (clientId/secret, no .env, global).
 * Cada organizacao conecta um banco -> gera um "item" (itemId), que fica
 * guardado por organizacao (Connection). As consultas usam esse itemId.
 */
@Injectable()
export class PluggyService {
  private readonly logger = new Logger(PluggyService.name);
  private readonly baseUrl = 'https://api.pluggy.ai';

  /** Conector sandbox padrao (Pluggy Bank) para testes. */
  static readonly SANDBOX_CONNECTOR_ID = 2;
  static readonly SANDBOX_CREDENTIALS = { user: 'user-ok', password: 'password-ok' };

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const id = this.config.get<string>('PLUGGY_CLIENT_ID');
    const secret = this.config.get<string>('PLUGGY_CLIENT_SECRET');
    return (
      !!id &&
      !!secret &&
      id !== 'COLE_AQUI_O_CLIENT_ID_PLUGGY' &&
      secret !== 'COLE_AQUI_O_CLIENT_SECRET_PLUGGY'
    );
  }

  /** Autentica e retorna um cliente HTTP com o X-API-KEY. */
  private async client(): Promise<AxiosInstance> {
    const { data } = await axios.post(`${this.baseUrl}/auth`, {
      clientId: this.config.get<string>('PLUGGY_CLIENT_ID'),
      clientSecret: this.config.get<string>('PLUGGY_CLIENT_SECRET'),
    });
    return axios.create({
      baseURL: this.baseUrl,
      headers: { 'X-API-KEY': data.apiKey, 'Content-Type': 'application/json' },
    });
  }

  /**
   * Cria um "connect token" para inicializar o widget Pluggy Connect
   * (fluxo de conexao de banco real via Open Finance).
   */
  async createConnectToken(): Promise<string> {
    const c = await this.client();
    const { data } = await c.post('/connect_token', {});
    return data.accessToken;
  }

  /** Cria um item (conexao bancaria) para um conector com credenciais. */
  async createItem(connectorId: number, parameters: Record<string, any>): Promise<any> {
    const c = await this.client();
    const { data } = await c.post('/items', { connectorId, parameters });
    return data;
  }

  /** Cria um item no banco sandbox (para testes). */
  async createSandboxItem(): Promise<any> {
    return this.createItem(
      PluggyService.SANDBOX_CONNECTOR_ID,
      PluggyService.SANDBOX_CREDENTIALS,
    );
  }

  /** Consulta um item pelo ID (status da conexao). */
  async getItem(itemId: string): Promise<any> {
    const c = await this.client();
    const { data } = await c.get(`/items/${itemId}`);
    return data;
  }

  /** Lista as contas de um item. */
  async listAccounts(itemId: string): Promise<any[]> {
    const c = await this.client();
    const { data } = await c.get('/accounts', { params: { itemId } });
    return data?.results ?? [];
  }

  /** Lista as transacoes de uma conta. */
  async listTransactions(accountId: string, pageSize = 15): Promise<any[]> {
    const c = await this.client();
    const { data } = await c.get('/transactions', {
      params: { accountId, pageSize },
    });
    return data?.results ?? [];
  }
}
