import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { HubspotService } from './hubspot.service';

/**
 * Registra as ferramentas do HubSpot. Multi-tenant: cada execucao resolve o
 * token da organizacao (conta conectada da org ou fallback do .env).
 */
@Injectable()
export class HubspotTools implements OnModuleInit {
  private readonly logger = new Logger(HubspotTools.name);
  private static readonly PROVIDER = 'hubspot';
  private static readonly ENV_KEY = 'HUBSPOT_ACCESS_TOKEN';

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly hubspot: HubspotService,
    private readonly connections: ConnectionsService,
  ) {}

  /** Resolve o token da organizacao (ou fallback do .env). */
  private token(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(
      context,
      HubspotTools.PROVIDER,
      HubspotTools.ENV_KEY,
    );
  }

  private naoConectado(): string {
    return 'O HubSpot ainda nao esta conectado para a sua organizacao. Conecte com a ferramenta de conectar integracao.';
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'hubspot_criar_empresa',
        description:
          'Cria uma nova empresa (Company) no HubSpot. Use quando o usuario pedir para cadastrar/adicionar uma empresa.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome da empresa' },
            phone: { type: 'string', description: 'Telefone (opcional)' },
            domain: { type: 'string', description: 'Site/dominio (opcional)' },
            city: { type: 'string', description: 'Cidade (opcional)' },
          },
          required: ['name'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const company = await this.hubspot.createCompany(token, input);
        return `Empresa criada no HubSpot com sucesso. ID: ${company.id}, nome: ${company.properties?.name}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_buscar_empresas',
        description:
          'Busca empresas cadastradas no HubSpot pelo nome. Use quando o usuario pedir para listar/consultar/encontrar empresas.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Termo de busca (nome da empresa)' },
          },
          required: ['query'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const results = await this.hubspot.searchCompanies(token, input.query);
        if (results.length === 0) return 'Nenhuma empresa encontrada com esse termo.';
        const lista = results
          .map((c) => `- ${c.properties?.name} (ID ${c.id})`)
          .join('\n');
        return `Empresas encontradas (${results.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_criar_contato',
        description:
          'Cria um novo contato (Contact) no HubSpot. Use quando o usuario pedir para cadastrar/adicionar um contato ou pessoa.',
        input_schema: {
          type: 'object',
          properties: {
            firstname: { type: 'string', description: 'Primeiro nome' },
            lastname: { type: 'string', description: 'Sobrenome (opcional)' },
            email: { type: 'string', description: 'E-mail (opcional)' },
            phone: { type: 'string', description: 'Telefone (opcional)' },
          },
          required: ['firstname'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const contact = await this.hubspot.createContact(token, input);
        return `Contato criado no HubSpot com sucesso. ID: ${contact.id}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_criar_negocio',
        description:
          'Cria um novo negocio/oportunidade (Deal) no HubSpot. Use quando o usuario pedir para criar uma oportunidade, negocio ou venda.',
        input_schema: {
          type: 'object',
          properties: {
            dealname: { type: 'string', description: 'Nome do negocio' },
            amount: { type: 'string', description: 'Valor, apenas numeros (ex: 80000)' },
          },
          required: ['dealname'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const deal = await this.hubspot.createDeal(token, input);
        return `Negocio criado no HubSpot com sucesso. ID: ${deal.id}.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_atualizar_empresa',
        description:
          'Atualiza os dados de uma empresa existente no HubSpot (ex: telefone, site, cidade). Identifique a empresa pelo nome.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome da empresa a atualizar' },
            phone: { type: 'string', description: 'Novo telefone (opcional)' },
            domain: { type: 'string', description: 'Novo site/dominio (opcional)' },
            city: { type: 'string', description: 'Nova cidade (opcional)' },
          },
          required: ['name'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const { name, ...changes } = input;
        const found = await this.hubspot.searchCompanies(token, name);
        if (found.length === 0)
          return `Nenhuma empresa chamada "${name}" foi encontrada para atualizar.`;
        const company = found[0];
        const props = Object.fromEntries(
          Object.entries(changes).filter(([, v]) => v != null && v !== ''),
        ) as Record<string, string>;
        if (Object.keys(props).length === 0)
          return 'Nenhum dado novo informado para atualizar.';
        await this.hubspot.updateCompany(token, company.id, props);
        return `Empresa "${company.properties?.name}" (ID ${company.id}) atualizada com sucesso.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_buscar_contatos',
        description:
          'Busca contatos (pessoas) no HubSpot por nome ou e-mail. Use quando o usuario pedir para listar/consultar/encontrar contatos.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Termo de busca (nome ou e-mail)' },
          },
          required: ['query'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const results = await this.hubspot.searchContacts(token, input.query);
        if (results.length === 0) return 'Nenhum contato encontrado com esse termo.';
        const lista = results
          .map((c) => {
            const p = c.properties ?? {};
            const nome = [p.firstname, p.lastname].filter(Boolean).join(' ');
            return `- ${nome || '(sem nome)'}${p.email ? ` <${p.email}>` : ''} (ID ${c.id})`;
          })
          .join('\n');
        return `Contatos encontrados (${results.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_atualizar_contato',
        description:
          'Atualiza os dados de um contato existente no HubSpot. Identifique o contato pelo nome ou e-mail atual.',
        input_schema: {
          type: 'object',
          properties: {
            busca: { type: 'string', description: 'Nome ou e-mail atual do contato' },
            firstname: { type: 'string', description: 'Novo primeiro nome (opcional)' },
            lastname: { type: 'string', description: 'Novo sobrenome (opcional)' },
            email: { type: 'string', description: 'Novo e-mail (opcional)' },
            phone: { type: 'string', description: 'Novo telefone (opcional)' },
          },
          required: ['busca'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const { busca, ...changes } = input;
        const found = await this.hubspot.searchContacts(token, busca);
        if (found.length === 0)
          return `Nenhum contato correspondente a "${busca}" foi encontrado.`;
        const contact = found[0];
        const props = Object.fromEntries(
          Object.entries(changes).filter(([, v]) => v != null && v !== ''),
        ) as Record<string, string>;
        if (Object.keys(props).length === 0)
          return 'Nenhum dado novo informado para atualizar.';
        await this.hubspot.updateContact(token, contact.id, props);
        return `Contato (ID ${contact.id}) atualizado com sucesso.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_buscar_negocios',
        description:
          'Busca negocios/oportunidades no HubSpot por nome. Use quando o usuario pedir para listar/consultar negocios.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Termo de busca (nome do negocio)' },
          },
          required: ['query'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const results = await this.hubspot.searchDeals(token, input.query);
        if (results.length === 0) return 'Nenhum negocio encontrado com esse termo.';
        const lista = results
          .map((d) => {
            const p = d.properties ?? {};
            const valor = p.amount ? ` — R$ ${p.amount}` : '';
            return `- ${p.dealname}${valor} (ID ${d.id})`;
          })
          .join('\n');
        return `Negocios encontrados (${results.length}):\n${lista}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_mover_negocio',
        description:
          'Move um negocio/oportunidade para outro estagio do funil no HubSpot. Identifique pelo nome e informe o estagio destino.',
        input_schema: {
          type: 'object',
          properties: {
            dealname: { type: 'string', description: 'Nome do negocio a mover' },
            stage: { type: 'string', description: 'Estagio de destino (ex: negociacao)' },
          },
          required: ['dealname', 'stage'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const deals = await this.hubspot.searchDeals(token, input.dealname);
        if (deals.length === 0)
          return `Nenhum negocio chamado "${input.dealname}" foi encontrado.`;
        const deal = deals[0];
        const stages = await this.hubspot.getDealStages(token);
        const wanted = input.stage.toLowerCase();
        const match =
          stages.find((s) => s.label.toLowerCase() === wanted) ||
          stages.find((s) => s.label.toLowerCase().includes(wanted)) ||
          stages.find((s) => wanted.includes(s.label.toLowerCase()));
        if (!match) {
          const disponiveis = stages.map((s) => s.label).join(', ');
          return `Nao identifiquei o estagio "${input.stage}". Estagios disponiveis: ${disponiveis}.`;
        }
        await this.hubspot.updateDeal(token, deal.id, { dealstage: match.id });
        return `Negocio "${deal.properties?.dealname}" movido para o estagio "${match.label}" com sucesso.`;
      },
    });

    this.registry.register({
      definition: {
        name: 'hubspot_criar_observacao',
        description:
          'Cria uma observacao/anotacao (Note) no HubSpot, opcionalmente vinculada a uma empresa.',
        input_schema: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'Conteudo da observacao' },
            empresa: { type: 'string', description: 'Nome da empresa para vincular (opcional)' },
          },
          required: ['texto'],
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        let companyId: string | undefined;
        if (input.empresa) {
          const found = await this.hubspot.searchCompanies(token, input.empresa);
          if (found.length > 0) companyId = found[0].id;
        }
        await this.hubspot.createNote(token, input.texto, companyId);
        const vinculo = companyId ? ` vinculada a empresa "${input.empresa}"` : '';
        return `Observacao registrada no HubSpot${vinculo} com sucesso.`;
      },
    });

    this.logger.log('Ferramentas do HubSpot registradas (multi-tenant).');
  }
}
