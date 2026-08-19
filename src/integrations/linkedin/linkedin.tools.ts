import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { CredencialLinkedin, LinkedinService } from './linkedin.service';

/**
 * Ferramentas do LinkedIn.
 *
 * Uma so, e de escrita. As permissoes abertas do LinkedIn nao permitem ler
 * feed, buscar perfis nem procurar empresas — so publicar em nome de quem
 * autorizou. Registrar uma ferramenta de leitura aqui seria oferecer a IA uma
 * capacidade que a API recusa, e ela acabaria prometendo ao cliente algo que
 * nao consegue entregar.
 */
@Injectable()
export class LinkedinTools implements OnModuleInit {
  private readonly logger = new Logger(LinkedinTools.name);

  /** Teto de caracteres de um post no LinkedIn. */
  private static readonly MAX_CARACTERES = 3000;

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly linkedin: LinkedinService,
    private readonly connections: ConnectionsService,
  ) {}

  /**
   * Credencial completa, e nao apenas o token.
   *
   * `resolveToken` devolve so o campo `token`, mas publicar exige tambem o URN
   * do autor — que guardamos junto no momento da conexao.
   */
  private async credencial(
    context?: ToolContext,
  ): Promise<CredencialLinkedin | undefined> {
    if (!context?.organizationId) return undefined;
    const conn = await this.connections.get(context.organizationId, 'linkedin');
    const cred = conn?.credentials as CredencialLinkedin | undefined;
    return cred?.token && cred?.urn ? cred : undefined;
  }

  onModuleInit(): void {
    if (!this.linkedin.isConfigured()) {
      this.logger.warn(
        'LinkedIn nao configurado (client id/secret) — ferramenta nao registrada.',
      );
      return;
    }

    this.registry.register({
      definition: {
        name: 'linkedin_publicar',
        description:
          'Publica um texto no LinkedIn, no perfil da pessoa que conectou a conta. ' +
          'Use quando o usuario pedir para postar, divulgar ou anunciar algo no LinkedIn. ' +
          'Escreva o texto no tom profissional do LinkedIn e mostre-o ao usuario antes de confirmar. ' +
          'NAO serve para ler o feed, buscar perfis ou procurar empresas — o LinkedIn nao ' +
          'permite isso sem parceria comercial.',
        input_schema: {
          type: 'object',
          properties: {
            texto: {
              type: 'string',
              description: `Conteudo do post, ate ${LinkedinTools.MAX_CARACTERES} caracteres.`,
            },
            link: {
              type: 'string',
              description: 'URL para anexar ao post (opcional).',
            },
            visibilidade: {
              type: 'string',
              enum: ['publico', 'conexoes'],
              description:
                'publico = qualquer pessoa no LinkedIn; conexoes = apenas conexoes de 1o grau. Padrao publico.',
            },
          },
          required: ['texto'],
        },
      },
      // Publicacao e IRREVERSIVEL na pratica: mesmo apagando depois, o post ja
      // apareceu no feed de quem viu, e pode ter sido notificado. Confirmar
      // antes nao e formalidade.
      escrita: true,
      execute: async (input, context?: ToolContext) => {
        const cred = await this.credencial(context);
        if (!cred) {
          return 'O LinkedIn ainda nao esta conectado para esta organizacao. Peca ao usuario para conectar na pagina de Integracoes.';
        }

        const texto = String(input?.texto ?? '').trim();
        if (!texto) return 'O texto do post esta vazio.';
        if (texto.length > LinkedinTools.MAX_CARACTERES) {
          return `O texto tem ${texto.length} caracteres e o limite do LinkedIn e ${LinkedinTools.MAX_CARACTERES}. Peca ao usuario para encurtar.`;
        }

        const visibilidade =
          String(input?.visibilidade ?? '').toLowerCase() === 'conexoes'
            ? 'CONNECTIONS'
            : 'PUBLIC';

        try {
          const id = await this.linkedin.publicar(
            cred.token,
            cred.urn,
            texto,
            visibilidade,
            input?.link ? String(input.link).trim() : undefined,
          );

          this.logger.log(
            `Post publicado no LinkedIn da organizacao ${context?.organizationId} (${id ?? 'sem id'}).`,
          );

          return (
            `Post publicado no LinkedIn${cred.nome ? ` de ${cred.nome}` : ''}, ` +
            `visivel para ${visibilidade === 'PUBLIC' ? 'qualquer pessoa' : 'as conexoes de 1o grau'}.`
          );
        } catch (erro: any) {
          const status = erro?.response?.status;
          const detalhe = erro?.response?.data ?? erro?.message ?? erro;
          this.logger.error(
            `Falha ao publicar no LinkedIn: ${status} ${JSON.stringify(detalhe)}`,
          );

          // 401 aqui quase sempre significa token de 60 dias vencido — e a
          // acao do cliente e outra (reconectar), entao a mensagem tem que
          // dizer isso em vez de um erro generico.
          if (status === 401 || status === 403) {
            return 'A autorizacao do LinkedIn expirou ou foi revogada. Peca ao usuario para reconectar na pagina de Integracoes.';
          }
          if (status === 429) {
            return `O LinkedIn recusou por excesso de publicacoes (limite de ${LinkedinService.LIMITE_DIARIO_MEMBRO} por dia). Tente novamente amanha.`;
          }

          return 'Nao consegui publicar no LinkedIn agora. Tente novamente em instantes.';
        }
      },
    });
  }
}
