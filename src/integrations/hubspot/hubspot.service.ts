import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o HubSpot (CRM).
 *
 * Multi-tenant: cada metodo recebe o `token` da organizacao que fez a chamada
 * (resolvido pelo ConnectionsService — conta da org ou fallback do .env).
 */
@Injectable()
export class HubspotService {
  private readonly logger = new Logger(HubspotService.name);
  private readonly baseUrl = 'https://api.hubapi.com';

  /** Cliente HTTP autenticado com o token informado. */
  private http(token: string): AxiosInstance {
    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Cria uma empresa (Company). */
  async createCompany(
    token: string,
    props: { name: string; phone?: string; domain?: string; city?: string },
  ): Promise<any> {
    const { data } = await this.http(token).post('/crm/v3/objects/companies', {
      properties: props,
    });
    return data;
  }

  /** Busca empresas por nome (retorna ate 10). */
  async searchCompanies(token: string, query: string): Promise<any[]> {
    const { data } = await this.http(token).post(
      '/crm/v3/objects/companies/search',
      { query, limit: 10, properties: ['name', 'phone', 'domain', 'city'] },
    );
    return data?.results ?? [];
  }

  /** Atualiza propriedades de uma empresa pelo ID. */
  async updateCompany(
    token: string,
    companyId: string,
    props: Record<string, string>,
  ): Promise<any> {
    const { data } = await this.http(token).patch(
      `/crm/v3/objects/companies/${companyId}`,
      { properties: props },
    );
    return data;
  }

  /** Cria um contato (Contact). */
  async createContact(
    token: string,
    props: { firstname: string; lastname?: string; email?: string; phone?: string },
  ): Promise<any> {
    const { data } = await this.http(token).post('/crm/v3/objects/contacts', {
      properties: props,
    });
    return data;
  }

  /** Busca contatos por nome/e-mail (retorna ate 10). */
  async searchContacts(token: string, query: string): Promise<any[]> {
    const { data } = await this.http(token).post(
      '/crm/v3/objects/contacts/search',
      { query, limit: 10, properties: ['firstname', 'lastname', 'email', 'phone'] },
    );
    return data?.results ?? [];
  }

  /** Atualiza propriedades de um contato pelo ID. */
  async updateContact(
    token: string,
    contactId: string,
    props: Record<string, string>,
  ): Promise<any> {
    const { data } = await this.http(token).patch(
      `/crm/v3/objects/contacts/${contactId}`,
      { properties: props },
    );
    return data;
  }

  /** Cria um negocio/oportunidade (Deal). */
  async createDeal(
    token: string,
    props: { dealname: string; amount?: string; dealstage?: string },
  ): Promise<any> {
    const { data } = await this.http(token).post('/crm/v3/objects/deals', {
      properties: props,
    });
    return data;
  }

  /** Busca negocios por nome (retorna ate 10). */
  async searchDeals(token: string, query: string): Promise<any[]> {
    const { data } = await this.http(token).post('/crm/v3/objects/deals/search', {
      query,
      limit: 10,
      properties: ['dealname', 'amount', 'dealstage'],
    });
    return data?.results ?? [];
  }

  /** Atualiza propriedades de um negocio pelo ID. */
  async updateDeal(
    token: string,
    dealId: string,
    props: Record<string, string>,
  ): Promise<any> {
    const { data } = await this.http(token).patch(
      `/crm/v3/objects/deals/${dealId}`,
      { properties: props },
    );
    return data;
  }

  /**
   * Consolida o funil inteiro: quantos negocios e quanto valor em cada estagio.
   *
   * Nao reaproveita `searchDeals` de proposito — aquele tem `limit: 10` fixo,
   * porque atende a pergunta "acha o negocio da empresa X" no chat. Somar um
   * funil com 10 de N negocios daria um numero errado com cara de certo, que e
   * exatamente o defeito que um painel nao pode ter.
   *
   * Pagina ate o fim, com teto: um CRM grande nao pode travar a coleta diaria.
   */
  async resumoDoFunil(
    token: string,
    maxPaginas = 20,
  ): Promise<{
    porEstagio: Map<string, { quantidade: number; valor: number }>;
    total: number;
    truncado: boolean;
  }> {
    const porEstagio = new Map<string, { quantidade: number; valor: number }>();
    let depois: string | undefined;
    let total = 0;
    let paginas = 0;

    do {
      const { data } = await this.http(token).get('/crm/v3/objects/deals', {
        params: {
          limit: 100,
          properties: 'dealstage,amount',
          ...(depois ? { after: depois } : {}),
        },
      });

      for (const negocio of data?.results ?? []) {
        const estagio = negocio?.properties?.dealstage ?? 'sem_estagio';
        // `amount` chega como string, e vem vazio em negocio sem valor.
        const valor = Number(negocio?.properties?.amount ?? 0) || 0;

        const atual = porEstagio.get(estagio) ?? { quantidade: 0, valor: 0 };
        atual.quantidade++;
        atual.valor += valor;
        porEstagio.set(estagio, atual);
        total++;
      }

      depois = data?.paging?.next?.after;
      paginas++;
    } while (depois && paginas < maxPaginas);

    return { porEstagio, total, truncado: !!depois };
  }

  /** Lista os estagios do pipeline de negocios (label + id interno). */
  async getDealStages(token: string): Promise<{ label: string; id: string }[]> {
    const { data } = await this.http(token).get('/crm/v3/pipelines/deals');
    const pipeline = data?.results?.[0];
    return (pipeline?.stages ?? []).map((s: any) => ({
      label: s.label,
      id: s.id,
    }));
  }

  /**
   * Cria uma observacao (Note), opcionalmente associada a uma empresa.
   */
  async createNote(
    token: string,
    body: string,
    companyId?: string,
  ): Promise<any> {
    const payload: any = {
      properties: { hs_note_body: body, hs_timestamp: Date.now() },
    };
    if (companyId) {
      payload.associations = [
        {
          to: { id: companyId },
          types: [
            { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 },
          ],
        },
      ];
    }
    const { data } = await this.http(token).post('/crm/v3/objects/notes', payload);
    return data;
  }
}
