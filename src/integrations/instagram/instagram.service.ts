import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/** Conta do Instagram Business vinculada a uma Pagina do Facebook. */
export interface ContaInstagram {
  id: string;
  username?: string;
  pagina?: string;
}

/** Perfil publico basico da conta. */
export interface PerfilInstagram {
  username?: string;
  nome?: string;
  seguidores: number;
  seguindo: number;
  publicacoes: number;
  bio?: string;
}

/** Metricas agregadas de um periodo. */
export interface MetricasInstagram {
  desde: string;
  ate: string;
  visualizacoes?: number;
  alcance?: number;
  contasEngajadas?: number;
  interacoes?: number;
  indisponiveis: string[];
}

/** Publicacao com seus contadores publicos. */
export interface PublicacaoInstagram {
  id: string;
  tipo?: string;
  legenda?: string;
  link?: string;
  data?: string;
  curtidas: number;
  comentarios: number;
}

/**
 * Service da integracao com o Instagram (API do Instagram com Login do Facebook).
 *
 * Multi-tenant: nenhum metodo le credencial do .env — cada um recebe o token
 * da organizacao. O token guardado e um *Page Access Token* de longa duracao,
 * que nao expira sozinho (ao contrario do token de usuario, que dura 60 dias).
 *
 * IMPORTANTE (metricas): `impressions` e `profile_views` foram descontinuadas
 * pela Meta (v21/v22, desligadas em 21/04/2025). A metrica que as substitui e
 * `views`. Nao reintroduza as antigas — a API retorna erro.
 *
 * IMPORTANTE 2: as metricas de insights exigem `metric_type=total_value`.
 * Ver o comentario em `getMetricas` antes de mexer nos parametros.
 */
@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  /** Permissoes pedidas no consentimento (Login do Facebook para Empresas). */
  static readonly SCOPES = [
    'instagram_basic',
    'instagram_manage_insights',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
  ];

  /** Teto de dias por consulta de insights (limite da propria API). */
  private static readonly MAX_DIAS = 30;

  /**
   * Cache da descoberta da conta (token -> conta). Evita uma chamada extra a
   * cada ferramenta executada. A chave e o token, entao trocar a conexao
   * invalida a entrada naturalmente.
   */
  private readonly contas = new Map<string, ContaInstagram>();

  constructor(private readonly config: ConfigService) {}

  /** As credenciais do app Meta estao configuradas? */
  isConfigured(): boolean {
    return (
      !!this.config.get<string>('META_APP_ID') &&
      !!this.config.get<string>('META_APP_SECRET')
    );
  }

  private version(): string {
    return this.config.get<string>('INSTAGRAM_API_VERSION') ?? 'v23.0';
  }

  private http(): AxiosInstance {
    return axios.create({
      baseURL: `https://graph.facebook.com/${this.version()}`,
      timeout: 20000,
    });
  }

  /** Converte erro da Graph API em mensagem legivel (e loga o detalhe). */
  private falha(e: any, acao: string): Error {
    const detalhe = e?.response?.data?.error;
    const msg = detalhe?.message ?? e?.message ?? 'erro desconhecido';
    this.logger.error(`Falha ao ${acao}: ${JSON.stringify(detalhe ?? msg)}`);
    return new Error(msg);
  }

  // ---------- OAuth ----------

  /** URL de consentimento. `state` carrega a organizacao que esta conectando. */
  generateAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.get<string>('META_APP_ID') ?? '',
      redirect_uri: this.config.get<string>('INSTAGRAM_REDIRECT_URI') ?? '',
      scope: InstagramService.SCOPES.join(','),
      response_type: 'code',
    });
    if (state) params.set('state', state);
    return `https://www.facebook.com/${this.version()}/dialog/oauth?${params}`;
  }

  /**
   * Troca o `code` por um Page Access Token de longa duracao.
   *
   * Sao tres passos encadeados, todos necessarios:
   *  1. code -> token de usuario de curta duracao (~1h)
   *  2. curta -> token de usuario de longa duracao (~60 dias)
   *  3. longa -> token da Pagina (nao expira sozinho)
   */
  async exchangeCode(
    code: string,
  ): Promise<{ token: string; conta: ContaInstagram }> {
    try {
      const { data: curto } = await this.http().get('/oauth/access_token', {
        params: {
          client_id: this.config.get<string>('META_APP_ID'),
          client_secret: this.config.get<string>('META_APP_SECRET'),
          redirect_uri: this.config.get<string>('INSTAGRAM_REDIRECT_URI'),
          code,
        },
      });

      const { data: longo } = await this.http().get('/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.config.get<string>('META_APP_ID'),
          client_secret: this.config.get<string>('META_APP_SECRET'),
          fb_exchange_token: curto.access_token,
        },
      });

      const { data: paginas } = await this.http().get('/me/accounts', {
        params: {
          fields: 'name,access_token,instagram_business_account{id,username}',
          access_token: longo.access_token,
        },
      });

      const pagina = (paginas?.data ?? []).find(
        (p: any) => p.instagram_business_account?.id,
      );
      if (!pagina) {
        throw new Error(
          'Nenhuma Pagina do Facebook com conta do Instagram vinculada foi encontrada. ' +
            'Verifique se a conta do Instagram e Business/Creator e esta vinculada a uma Pagina.',
        );
      }

      return {
        token: pagina.access_token,
        conta: {
          id: pagina.instagram_business_account.id,
          username: pagina.instagram_business_account.username,
          pagina: pagina.name,
        },
      };
    } catch (e: any) {
      throw this.falha(e, 'trocar o code por token');
    }
  }

  // ---------- Descoberta da conta ----------

  /**
   * Descobre a conta do Instagram a partir do token.
   *
   * Aceita os dois tipos de token que podem chegar aqui: o da Pagina (fluxo
   * normal, `/me` ja e a Pagina) e o de usuario (caso alguem cole um token do
   * Graph Explorer no .env), quando e preciso passar por `/me/accounts`.
   */
  async resolveConta(token: string): Promise<ContaInstagram> {
    const emCache = this.contas.get(token);
    if (emCache) return emCache;

    try {
      const { data } = await this.http().get('/me', {
        params: {
          fields: 'name,instagram_business_account{id,username}',
          access_token: token,
        },
      });

      let conta: ContaInstagram | undefined;

      if (data?.instagram_business_account?.id) {
        conta = {
          id: data.instagram_business_account.id,
          username: data.instagram_business_account.username,
          pagina: data.name,
        };
      } else {
        // Token de usuario: procura entre as Paginas administradas.
        const { data: paginas } = await this.http().get('/me/accounts', {
          params: {
            fields: 'name,instagram_business_account{id,username}',
            access_token: token,
          },
        });
        const pagina = (paginas?.data ?? []).find(
          (p: any) => p.instagram_business_account?.id,
        );
        if (pagina) {
          conta = {
            id: pagina.instagram_business_account.id,
            username: pagina.instagram_business_account.username,
            pagina: pagina.name,
          };
        }
      }

      if (!conta) {
        throw new Error(
          'Nenhuma conta do Instagram Business vinculada foi encontrada para este acesso.',
        );
      }

      this.contas.set(token, conta);
      return conta;
    } catch (e: any) {
      throw this.falha(e, 'descobrir a conta do Instagram');
    }
  }

  // ---------- Consultas ----------

  async getPerfil(token: string): Promise<PerfilInstagram> {
    const conta = await this.resolveConta(token);
    try {
      const { data } = await this.http().get(`/${conta.id}`, {
        params: {
          fields:
            'username,name,biography,followers_count,follows_count,media_count',
          access_token: token,
        },
      });
      return {
        username: data.username,
        nome: data.name,
        bio: data.biography,
        seguidores: data.followers_count ?? 0,
        seguindo: data.follows_count ?? 0,
        publicacoes: data.media_count ?? 0,
      };
    } catch (e: any) {
      throw this.falha(e, 'consultar o perfil');
    }
  }

  /**
   * Metricas do periodo.
   *
   * ATENCAO: todas estas metricas exigem `metric_type=total_value` — sem ele a
   * API responde `(#100) The following metrics (views) should be specified with
   * parameter metric_type=total_value`. Com `total_value` o valor vem agregado
   * em `total_value.value` (nao ha serie diaria em `values`).
   */
  async getMetricas(token: string, dias = 7): Promise<MetricasInstagram> {
    const conta = await this.resolveConta(token);
    const janela = Math.min(Math.max(1, dias), InstagramService.MAX_DIAS);

    const ate = new Date();
    const desde = new Date();
    desde.setDate(desde.getDate() - janela);

    const indisponiveis: string[] = [];
    const resultado: MetricasInstagram = {
      desde: desde.toISOString().slice(0, 10),
      ate: ate.toISOString().slice(0, 10),
      indisponiveis,
    };

    try {
      const { data } = await this.http().get(`/${conta.id}/insights`, {
        params: {
          metric: 'views,reach,accounts_engaged,total_interactions',
          period: 'day',
          metric_type: 'total_value',
          since: Math.floor(desde.getTime() / 1000),
          until: Math.floor(ate.getTime() / 1000),
          access_token: token,
        },
      });

      for (const m of data?.data ?? []) {
        const total = m.total_value?.value ?? 0;
        if (m.name === 'views') resultado.visualizacoes = total;
        if (m.name === 'reach') resultado.alcance = total;
        if (m.name === 'accounts_engaged') resultado.contasEngajadas = total;
        if (m.name === 'total_interactions') resultado.interacoes = total;
      }
    } catch (e: any) {
      indisponiveis.push('metricas do periodo');
      this.logger.warn(
        `Metricas indisponiveis: ${
          e?.response?.data?.error?.message ?? e?.message
        }`,
      );
    }

    return resultado;
  }

  async listarPublicacoes(
    token: string,
    limite = 5,
  ): Promise<PublicacaoInstagram[]> {
    const conta = await this.resolveConta(token);
    try {
      const { data } = await this.http().get(`/${conta.id}/media`, {
        params: {
          fields:
            'id,caption,media_type,permalink,timestamp,like_count,comments_count',
          limit: Math.min(Math.max(1, limite), 25),
          access_token: token,
        },
      });
      return (data?.data ?? []).map((m: any) => ({
        id: m.id,
        tipo: m.media_type,
        legenda: m.caption,
        link: m.permalink,
        data: m.timestamp,
        curtidas: m.like_count ?? 0,
        comentarios: m.comments_count ?? 0,
      }));
    } catch (e: any) {
      throw this.falha(e, 'listar as publicacoes');
    }
  }
}
