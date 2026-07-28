import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ConnectionsService } from '../../connections/connections.service';
import { ToolContext } from '../../tools/tool.interface';
import { InstagramService, PublicacaoInstagram } from './instagram.service';

/**
 * Ferramentas do Instagram (metricas e perfil), multi-tenant. Cada execucao
 * resolve o token da organizacao (conta conectada da org ou fallback do .env).
 *
 * Nomenclatura: `instagram_*` e nao um verbo generico. As planilhas viraram
 * `planilha_*` porque o dono pensa "planilha", nao "Google Sheets" — mas aqui
 * ele diz "meu Instagram" explicitamente, entao abstrair seria inventar um
 * conceito que ninguem usa.
 */
@Injectable()
export class InstagramTools implements OnModuleInit {
  private readonly logger = new Logger(InstagramTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly instagram: InstagramService,
    private readonly connections: ConnectionsService,
    private readonly config: ConfigService,
  ) {}

  private token(context?: ToolContext): Promise<string | undefined> {
    return this.connections.resolveToken(
      context,
      'instagram',
      'INSTAGRAM_ACCESS_TOKEN',
    );
  }

  private naoConectado(): string {
    return 'O Instagram ainda nao esta conectado para a sua organizacao. Peca o link de conexao do Instagram.';
  }

  private numero(valor?: number): string {
    return (valor ?? 0).toLocaleString('pt-BR');
  }

  private formatPublicacao(p: PublicacaoInstagram): string {
    const data = p.data ? new Date(p.data).toLocaleDateString('pt-BR') : '';
    const legenda = (p.legenda ?? '(sem legenda)').replace(/\s+/g, ' ').slice(0, 80);
    return `- ${data} [${p.tipo ?? '—'}] ${legenda} — ${this.numero(
      p.curtidas,
    )} curtidas, ${this.numero(p.comentarios)} comentarios\n  ${p.link ?? ''}`;
  }

  onModuleInit(): void {
    if (!this.instagram.isConfigured()) {
      this.logger.warn(
        'Instagram nao configurado (META_APP_ID/META_APP_SECRET) — ferramentas do Instagram nao registradas.',
      );
      return;
    }

    // Link de conexao (OAuth) da organizacao.
    this.registry.register({
      definition: {
        name: 'kyrius_conectar_instagram',
        description:
          'Gera o link para o usuario conectar a propria conta do Instagram (Business/Creator) a sua organizacao. Use quando o usuario pedir para conectar/autorizar o Instagram.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        if (!context?.organizationId)
          return 'Nao consegui identificar sua organizacao.';
        const redirect =
          this.config.get<string>('INSTAGRAM_REDIRECT_URI') ?? '';
        const authBase = redirect.replace(
          '/instagram/callback',
          '/instagram/auth',
        );
        return `Para conectar seu Instagram, abra este link no navegador e autorize (marque todas as permissoes e selecione a Pagina do Facebook vinculada):\n${authBase}?org=${context.organizationId}`;
      },
    });

    this.registry.register({
      definition: {
        name: 'instagram_resumo_conta',
        description:
          'Mostra o resumo do perfil do Instagram: seguidores, contas seguidas e total de publicacoes. Use quando o usuario perguntar quantos seguidores tem ou pedir um panorama da conta.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();
        const p = await this.instagram.getPerfil(token);
        return [
          `Instagram @${p.username ?? '—'}${p.nome ? ` (${p.nome})` : ''}`,
          `Seguidores: ${this.numero(p.seguidores)}`,
          `Seguindo: ${this.numero(p.seguindo)}`,
          `Publicacoes: ${this.numero(p.publicacoes)}`,
        ].join('\n');
      },
    });

    this.registry.register({
      definition: {
        name: 'instagram_metricas',
        description:
          'Consulta as metricas do Instagram em um periodo: visualizacoes, alcance, contas engajadas e interacoes. Use quando o usuario perguntar o desempenho, alcance ou engajamento do Instagram.',
        input_schema: {
          type: 'object',
          properties: {
            dias: {
              type: 'number',
              description: 'Quantos dias olhar para tras (padrao 7, maximo 30)',
            },
          },
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();

        const m = await this.instagram.getMetricas(token, input?.dias ?? 7);
        const linhas = [`Instagram — de ${m.desde} a ${m.ate}:`];

        if (m.visualizacoes !== undefined)
          linhas.push(`Visualizacoes: ${this.numero(m.visualizacoes)}`);
        if (m.alcance !== undefined)
          linhas.push(`Alcance: ${this.numero(m.alcance)}`);
        if (m.contasEngajadas !== undefined)
          linhas.push(`Contas engajadas: ${this.numero(m.contasEngajadas)}`);
        if (m.interacoes !== undefined)
          linhas.push(`Interacoes: ${this.numero(m.interacoes)}`);

        if (m.indisponiveis.length > 0)
          linhas.push(
            `\n(Nao foi possivel obter: ${m.indisponiveis.join(', ')}. Contas novas ou com pouco movimento podem nao ter dados suficientes.)`,
          );

        return linhas.join('\n');
      },
    });

    this.registry.register({
      definition: {
        name: 'instagram_posts_recentes',
        description:
          'Lista as publicacoes mais recentes do Instagram com curtidas e comentarios. Use quando o usuario perguntar sobre os ultimos posts ou qual post teve melhor desempenho.',
        input_schema: {
          type: 'object',
          properties: {
            limite: {
              type: 'number',
              description: 'Quantas publicacoes listar (padrao 5, maximo 25)',
            },
          },
        },
      },
      execute: async (input, context) => {
        const token = await this.token(context);
        if (!token) return this.naoConectado();

        const posts = await this.instagram.listarPublicacoes(
          token,
          input?.limite ?? 5,
        );
        if (posts.length === 0) return 'Nenhuma publicacao encontrada na conta.';

        return `Publicacoes recentes (${posts.length}):\n${posts
          .map((p) => this.formatPublicacao(p))
          .join('\n')}`;
      },
    });
  }
}
