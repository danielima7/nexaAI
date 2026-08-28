import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolContext } from '../tools/tool.interface';
import { ConsentimentoService } from './consentimento.service';
import { TemplateService } from './template.service';
import { EnvioWhatsappService } from './envio-whatsapp.service';

/**
 * Ferramentas de WhatsApp: consentimento, templates e envio individual.
 *
 * Nenhuma delas envia para lista. Prospeccao fria por WhatsApp e proibida pela
 * politica da plataforma — a ferramenta para abordar quem ainda nao e cliente e
 * `prospeccao_enviar_email`.
 */
@Injectable()
export class WhatsappEnvioTools implements OnModuleInit {
  private readonly logger = new Logger(WhatsappEnvioTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly consentimento: ConsentimentoService,
    private readonly templates: TemplateService,
    private readonly envio: EnvioWhatsappService,
  ) {}

  private semOrg(): string {
    return 'Nao consegui identificar a organizacao desta conversa.';
  }

  onModuleInit(): void {
    this.registrarConsentimento();
    this.registrarRevogar();
    this.registrarTemplates();
    this.registrarEnviar();
  }

  private registrarConsentimento(): void {
    this.registry.register({
      definition: {
        name: 'whatsapp_registrar_consentimento',
        description:
          'Registra que um contato AUTORIZOU receber mensagens no WhatsApp. ' +
          'Obrigatorio antes de qualquer envio: a politica do WhatsApp so permite escrever ' +
          'para quem forneceu o numero e consentiu. Peca ao usuario COMO o consentimento foi ' +
          'obtido (formulario, contrato, pedido no balcao) — e esse registro que comprova.',
        input_schema: {
          type: 'object',
          properties: {
            telefone: { type: 'string', description: 'Com DDD, ex: 24999998888.' },
            origem: {
              type: 'string',
              description:
                'Como a pessoa autorizou. Ex: "marcou a caixa no formulario de pedido em 03/09".',
            },
            nome: { type: 'string', description: 'Nome do contato, se souber.' },
          },
          required: ['telefone', 'origem'],
        },
      },
      escrita: true,
      execute: async (input, ctx?: ToolContext) => {
        if (!ctx?.organizationId) return this.semOrg();
        const r = await this.consentimento.registrar(ctx.organizationId, {
          telefone: String(input?.telefone ?? ''),
          origem: String(input?.origem ?? ''),
          nome: input?.nome ? String(input.nome) : undefined,
        });
        return r.motivo;
      },
    });
  }

  private registrarRevogar(): void {
    this.registry.register({
      definition: {
        name: 'whatsapp_revogar_consentimento',
        description:
          'Marca que um contato NAO quer mais receber mensagens no WhatsApp. ' +
          'Use assim que a pessoa pedir para parar, sair ou nao ter interesse.',
        input_schema: {
          type: 'object',
          properties: { telefone: { type: 'string' } },
          required: ['telefone'],
        },
      },
      // Sem confirmacao: quem pede para sair tem que sair na hora.
      execute: async (input, ctx?: ToolContext) => {
        if (!ctx?.organizationId) return this.semOrg();
        await this.consentimento.revogar(
          ctx.organizationId,
          String(input?.telefone ?? ''),
        );
        return 'Contato removido. Ele nao recebera mais mensagens no WhatsApp.';
      },
    });
  }

  private registrarTemplates(): void {
    this.registry.register({
      definition: {
        name: 'whatsapp_salvar_template',
        description:
          'Cria ou edita um modelo de mensagem do WhatsApp. Fora da janela de 24h, so ' +
          'template APROVADO pela Meta pode ser enviado — texto livre e recusado pela plataforma. ' +
          'Use {{1}}, {{2}} para as partes que mudam, numeradas em sequencia. ' +
          'Ex: "Ola {{1}}, seu boleto de {{2}} vence em {{3}}."',
        input_schema: {
          type: 'object',
          properties: {
            nome: {
              type: 'string',
              description: 'So minusculas, numeros e sublinhado. Ex: lembrete_vencimento',
            },
            corpo: { type: 'string', description: 'Texto com {{1}}, {{2}}...' },
          },
          required: ['nome', 'corpo'],
        },
      },
      escrita: true,
      execute: async (input, ctx?: ToolContext) => {
        if (!ctx?.organizationId) return this.semOrg();
        const r = await this.templates.salvar(ctx.organizationId, {
          nome: String(input?.nome ?? ''),
          corpo: String(input?.corpo ?? ''),
        });
        return r.motivo;
      },
    });

    this.registry.register({
      definition: {
        name: 'whatsapp_listar_templates',
        description:
          'Lista os modelos de mensagem do WhatsApp e o status de aprovacao de cada um.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, ctx?: ToolContext) => {
        if (!ctx?.organizationId) return this.semOrg();

        const lista = await this.templates.listar(ctx.organizationId);
        if (lista.length === 0) {
          return 'Nenhum template cadastrado ainda.';
        }

        const resumo = await this.consentimento.resumo(ctx.organizationId);
        return (
          `Templates (${lista.length}):\n` +
          lista
            .map((t) => `- ${t.nome} [${t.status}] — ${t.variaveis} variavel(is)`)
            .join('\n') +
          `\n\nContatos autorizados: ${resumo.ativos}. Revogados: ${resumo.revogados}.`
        );
      },
    });
  }

  private registrarEnviar(): void {
    this.registry.register({
      definition: {
        name: 'whatsapp_enviar_mensagem',
        description:
          'Envia UMA mensagem de WhatsApp para UM contato que ja autorizou. ' +
          'Use para aviso a cliente existente: lembrete de vencimento, confirmacao de ' +
          'agendamento, aviso de entrega. ' +
          'NAO serve para prospeccao — a politica do WhatsApp proibe mensagem para quem nao ' +
          'autorizou, e a punicao e o banimento do numero da empresa. Para abordar quem ainda ' +
          'nao e cliente, use prospeccao_enviar_email.',
        input_schema: {
          type: 'object',
          properties: {
            telefone: { type: 'string', description: 'Com DDD.' },
            template: {
              type: 'string',
              description:
                'Nome do template aprovado. Obrigatorio, exceto quando o contato escreveu nas ultimas 24h.',
            },
            valores: {
              type: 'array',
              items: { type: 'string' },
              description: 'Valores de {{1}}, {{2}}... na ordem.',
            },
            texto: {
              type: 'string',
              description:
                'Texto livre. So funciona se o contato tiver escrito nas ultimas 24 horas.',
            },
          },
          required: ['telefone'],
        },
      },
      escrita: true,
      execute: async (input, ctx?: ToolContext) => {
        if (!ctx?.organizationId) return this.semOrg();

        const telefone = String(input?.telefone ?? '');

        if (input?.template) {
          const r = await this.envio.enviarTemplate(ctx.organizationId, {
            telefone,
            template: String(input.template),
            valores: Array.isArray(input?.valores)
              ? input.valores.map(String)
              : [],
          });
          return r.motivo;
        }

        if (input?.texto) {
          const r = await this.envio.responder(
            ctx.organizationId,
            telefone,
            String(input.texto),
          );
          return r.motivo;
        }

        return 'Informe um template aprovado ou, se o contato escreveu nas ultimas 24h, o texto da resposta.';
      },
    });
  }
}
