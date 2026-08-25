import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolContext } from '../tools/tool.interface';
import { ProspeccaoService } from './prospeccao.service';

/**
 * Ferramentas de prospeccao por e-mail.
 *
 * Tres, e nenhuma delas envia em lote. A IA le a planilha com as ferramentas
 * de planilha que ja existem, e usa `prospeccao_enviar_email` UMA VEZ POR
 * CONTATO, com confirmacao a cada envio.
 *
 * Nao ha ferramenta de disparo em massa de proposito: ela transformaria um
 * pedido de uma frase em cem e-mails saindo antes de alguem poder olhar, e o
 * primeiro erro de redacao ja teria virado cem denuncias de spam.
 */
@Injectable()
export class ProspeccaoTools implements OnModuleInit {
  private readonly logger = new Logger(ProspeccaoTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly prospeccao: ProspeccaoService,
  ) {}

  private semOrganizacao(): string {
    return 'Nao consegui identificar a organizacao desta conversa.';
  }

  onModuleInit(): void {
    this.registrarEnviar();
    this.registrarSituacao();
    this.registrarDescadastrar();
  }

  private registrarEnviar(): void {
    this.registry.register({
      definition: {
        name: 'prospeccao_enviar_email',
        description:
          'Envia UM e-mail de prospeccao e registra o contato para nao repetir. ' +
          'Use quando o usuario quiser abordar possiveis clientes por e-mail. ' +
          'Para uma lista, chame esta ferramenta uma vez por contato, sempre mostrando o texto antes. ' +
          'Escreva mensagem CURTA e personalizada com o nome e o ramo do contato — ' +
          'texto generico enviado em volume e o que faz o e-mail cair em spam. ' +
          'A ferramenta recusa sozinha contato repetido, quem pediu para sair, e envio acima do teto diario.',
        input_schema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Endereco do destinatario.' },
            assunto: {
              type: 'string',
              description: 'Assunto do e-mail. Curto e especifico, sem promessa exagerada.',
            },
            corpo: {
              type: 'string',
              description:
                'Texto da mensagem. Personalize com nome e contexto. Nao precisa incluir forma de descadastro — ela e acrescentada automaticamente.',
            },
            nome: { type: 'string', description: 'Nome do contato, se souber.' },
            empresa: { type: 'string', description: 'Empresa do contato, se souber.' },
            origem: {
              type: 'string',
              description: 'De onde veio o contato (nome da planilha, por exemplo).',
            },
          },
          required: ['email', 'assunto', 'corpo'],
        },
      },
      // Enviar e-mail em nome do cliente para um terceiro e irreversivel: nao
      // existe "desenviar", e a impressao que a mensagem causa e permanente.
      escrita: true,
      execute: async (input, context?: ToolContext) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const r = await this.prospeccao.enviar(context.organizationId, {
          email: String(input?.email ?? ''),
          assunto: String(input?.assunto ?? '').trim(),
          corpo: String(input?.corpo ?? '').trim(),
          nome: input?.nome ? String(input.nome).trim() : undefined,
          empresa: input?.empresa ? String(input.empresa).trim() : undefined,
          origem: input?.origem ? String(input.origem).trim() : undefined,
        });

        return r.motivo;
      },
    });
  }

  private registrarSituacao(): void {
    this.registry.register({
      definition: {
        name: 'prospeccao_situacao',
        description:
          'Mostra quantos e-mails de prospeccao ja sairam hoje, quantos ainda cabem no teto diario ' +
          'e quantos contatos existem no total. Use antes de comecar uma lista, para o usuario saber ' +
          'quanto da lista cabe hoje.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context?: ToolContext) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const s = await this.prospeccao.situacao(context.organizationId);
        return (
          `Enviados hoje: ${s.enviadosHoje} de ${s.tetoDiario} (restam ${s.restanteHoje}).\n` +
          `Contatos ja abordados no total: ${s.totalContatados}.\n` +
          `Descadastrados: ${s.descadastrados}.`
        );
      },
    });
  }

  private registrarDescadastrar(): void {
    this.registry.register({
      definition: {
        name: 'prospeccao_descadastrar',
        description:
          'Marca um endereco para NUNCA mais receber prospeccao. Use assim que alguem pedir ' +
          'para sair, parar de receber, ou responder que nao tem interesse. ' +
          'Funciona mesmo para quem ainda nao foi contatado.',
        input_schema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Endereco a remover.' },
            motivo: { type: 'string', description: 'O que a pessoa disse, se houver.' },
          },
          required: ['email'],
        },
      },
      // Nao pede confirmacao de proposito: quem pediu para sair tem que sair na
      // hora. Uma pergunta a mais aqui e mais uma chance de o pedido se perder.
      execute: async (input, context?: ToolContext) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const email = String(input?.email ?? '').trim();
        if (!email.includes('@')) return `"${email}" nao parece um e-mail valido.`;

        await this.prospeccao.descadastrar(
          context.organizationId,
          email,
          input?.motivo ? String(input.motivo) : undefined,
        );

        return `${email.toLowerCase()} foi removido. Este endereco nao recebera mais prospeccao.`;
      },
    });
  }
}
