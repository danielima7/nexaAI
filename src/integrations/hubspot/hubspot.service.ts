import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Service da integracao com o HubSpot (CRM).
 *
 * Encapsula as chamadas a API oficial do HubSpot (api.hubapi.com).
 * As ferramentas expostas a IA vivem em hubspot.tools.ts e chamam estes metodos.
 */
@Injectable()
export class HubspotService {
  private readonly logger = new Logger(HubspotService.name);
  private readonly baseUrl = 'https://api.hubapi.com';

  constructor(private readonly config: ConfigService) {}

  /** O token esta configurado no .env? */
  isConfigured(): boolean {
    const token = this.config.get<string>('HUBSPOT_ACCESS_TOKEN');
    return !!token && token !== 'COLE_AQUI_O_TOKEN_DO_HUBSPOT';
  }

  /** Cliente HTTP autenticado para o HubSpot. */
  private http(): AxiosInstance {
    const token = this.config.get<string>('HUBSPOT_ACCESS_TOKEN');
    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Cria uma empresa (Company). */
  async createCompany(props: {
    name: string;
    phone?: string;
    domain?: string;
    city?: string;
  }): Promise<any> {
    const { data } = await this.http().post('/crm/v3/objects/companies', {
      properties: props,
    });
    return data;
  }

  /** Busca empresas por nome (retorna ate 10). */
  async searchCompanies(query: string): Promise<any[]> {
    const { data } = await this.http().post(
      '/crm/v3/objects/companies/search',
      {
        query,
        limit: 10,
        properties: ['name', 'phone', 'domain', 'city'],
      },
    );
    return data?.results ?? [];
  }

  /** Atualiza propriedades de uma empresa pelo ID. */
  async updateCompany(companyId: string, props: Record<string, string>): Promise<any> {
    const { data } = await this.http().patch(
      `/crm/v3/objects/companies/${companyId}`,
      { properties: props },
    );
    return data;
  }

  /** Busca contatos por nome/e-mail (retorna ate 10). */
  async searchContacts(query: string): Promise<any[]> {
    const { data } = await this.http().post(
      '/crm/v3/objects/contacts/search',
      {
        query,
        limit: 10,
        properties: ['firstname', 'lastname', 'email', 'phone'],
      },
    );
    return data?.results ?? [];
  }

  /** Atualiza propriedades de um contato pelo ID. */
  async updateContact(contactId: string, props: Record<string, string>): Promise<any> {
    const { data } = await this.http().patch(
      `/crm/v3/objects/contacts/${contactId}`,
      { properties: props },
    );
    return data;
  }

  /**
   * Cria uma observacao (Note), opcionalmente associada a uma empresa.
   * @param body texto da observacao
   * @param companyId (opcional) associa a nota a esta empresa
   */
  async createNote(body: string, companyId?: string): Promise<any> {
    const payload: any = {
      properties: {
        hs_note_body: body,
        hs_timestamp: Date.now(),
      },
    };
    if (companyId) {
      // associationTypeId 190 = Note -> Company (HUBSPOT_DEFINED)
      payload.associations = [
        {
          to: { id: companyId },
          types: [
            { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 },
          ],
        },
      ];
    }
    const { data } = await this.http().post('/crm/v3/objects/notes', payload);
    return data;
  }

  /** Busca negocios por nome (retorna ate 10). */
  async searchDeals(query: string): Promise<any[]> {
    const { data } = await this.http().post('/crm/v3/objects/deals/search', {
      query,
      limit: 10,
      properties: ['dealname', 'amount', 'dealstage'],
    });
    return data?.results ?? [];
  }

  /** Atualiza propriedades de um negocio pelo ID. */
  async updateDeal(dealId: string, props: Record<string, string>): Promise<any> {
    const { data } = await this.http().patch(
      `/crm/v3/objects/deals/${dealId}`,
      { properties: props },
    );
    return data;
  }

  /** Lista os estagios do pipeline de negocios (label + id interno). */
  async getDealStages(): Promise<{ label: string; id: string }[]> {
    const { data } = await this.http().get('/crm/v3/pipelines/deals');
    const pipeline = data?.results?.[0];
    return (pipeline?.stages ?? []).map((s: any) => ({
      label: s.label,
      id: s.id,
    }));
  }

  /** Cria um contato (Contact). */
  async createContact(props: {
    firstname: string;
    lastname?: string;
    email?: string;
    phone?: string;
  }): Promise<any> {
    const { data } = await this.http().post('/crm/v3/objects/contacts', {
      properties: props,
    });
    return data;
  }

  /** Cria um negocio/oportunidade (Deal). */
  async createDeal(props: {
    dealname: string;
    amount?: string;
    dealstage?: string;
  }): Promise<any> {
    const { data } = await this.http().post('/crm/v3/objects/deals', {
      properties: props,
    });
    return data;
  }
}
