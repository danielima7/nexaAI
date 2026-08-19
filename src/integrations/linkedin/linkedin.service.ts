import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** Identidade do membro autenticado, o suficiente para publicar por ele. */
export interface MembroLinkedin {
  /** Identificador do membro, usado para montar o URN do autor. */
  sub: string;
  nome?: string;
}

/** Credencial guardada em Connection.credentials para o provedor 'linkedin'. */
export interface CredencialLinkedin {
  /** Access token. `resolveToken` le exatamente este campo. */
  token: string;
  /** URN do autor (urn:li:person:xxx), obtido uma vez na conexao. */
  urn: string;
  /** Quando o token perde a validade (ISO). Ver o comentario sobre 60 dias. */
  expiraEm?: string;
  nome?: string;
}

/**
 * Integracao com o LinkedIn.
 *
 * ESCOPO DELIBERADAMENTE PEQUENO. A documentacao do LinkedIn e explicita: sem
 * aprovacao em programa de parceria, um app tem acesso a apenas tres
 * permissoes abertas — ler o proprio perfil, o proprio e-mail, e publicar em
 * nome de quem autorizou. Buscar perfis, procurar empresas ou extrair contatos
 * para prospeccao exigem ser parceiro Sales Navigator (SNAP), e nao existem
 * aqui. Nao adianta tentar: os endpoints respondem 403.
 *
 * Por isso a unica capacidade util para o Katalli e PUBLICAR — que se encaixa
 * na camada de acoes do produto: o dono pede pelo chat e o post sai, sem abrir
 * o LinkedIn.
 *
 * ⚠️ O TOKEN DURA ~60 DIAS E NAO HA REFRESH nas permissoes abertas. Quando
 * vence, o cliente precisa reconectar. E o mesmo problema do Google, so que
 * mais espacado — e por isso o LinkedIn tambem entra no ValidadorConexoes,
 * para o cliente ver "Reconectar" na tela em vez de descobrir na hora que o
 * post nao saiu.
 */
@Injectable()
export class LinkedinService {
  private readonly logger = new Logger(LinkedinService.name);

  /**
   * Permissoes pedidas.
   *
   * `openid` e `profile` nao sao enfeite: o endpoint de publicacao exige o URN
   * do autor, e o unico jeito de descobri-lo e chamar /userinfo, que precisa
   * desses escopos. `email` foi deixado de fora de proposito — nao usamos, e
   * pedir dado que nao se usa e pedir confianca a toa.
   */
  static readonly SCOPES = ['openid', 'profile', 'w_member_social'];

  /** Teto diario POR MEMBRO imposto pelo LinkedIn. Documentado, nao escolhido. */
  static readonly LIMITE_DIARIO_MEMBRO = 150;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return (
      !!this.config.get<string>('LINKEDIN_CLIENT_ID') &&
      !!this.config.get<string>('LINKEDIN_CLIENT_SECRET')
    );
  }

  private get redirectUri(): string {
    return this.config.get<string>('LINKEDIN_REDIRECT_URI') ?? '';
  }

  /** URL de consentimento. `state` carrega a organizacao que esta conectando. */
  generateAuthUrl(state?: string): string {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.get<string>('LINKEDIN_CLIENT_ID') ?? '',
      redirect_uri: this.redirectUri,
      scope: LinkedinService.SCOPES.join(' '),
    });
    if (state) p.set('state', state);

    return `https://www.linkedin.com/oauth/v2/authorization?${p.toString()}`;
  }

  /** Troca o code por access token. */
  async exchangeCode(
    code: string,
  ): Promise<{ access_token: string; expires_in?: number }> {
    const corpo = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.config.get<string>('LINKEDIN_CLIENT_ID') ?? '',
      client_secret: this.config.get<string>('LINKEDIN_CLIENT_SECRET') ?? '',
    });

    const { data } = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      corpo.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    return data;
  }

  /**
   * Identidade do membro autenticado.
   *
   * Chamado UMA vez, no momento da conexao, e o resultado e guardado junto da
   * credencial. Buscar o URN a cada publicacao gastaria uma requisicao do teto
   * diario de 150 por membro — metade da cota iria para descobrir algo que
   * nunca muda.
   */
  async getMembro(token: string): Promise<MembroLinkedin> {
    const { data } = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { sub: data?.sub, nome: data?.name };
  }

  /**
   * Publica um texto no feed do membro.
   *
   * Usa a API `ugcPosts`, que e a documentada para a permissao aberta
   * `w_member_social`. O header `X-Restli-Protocol-Version` e obrigatorio — sem
   * ele a requisicao e recusada com erro que nao explica a causa.
   *
   * @param visibilidade `PUBLIC` (qualquer um no LinkedIn) ou `CONNECTIONS`
   *   (apenas conexoes de primeiro grau).
   * @returns id do post criado, devolvido no header `x-restli-id`.
   */
  async publicar(
    token: string,
    urn: string,
    texto: string,
    visibilidade: 'PUBLIC' | 'CONNECTIONS' = 'PUBLIC',
    link?: string,
  ): Promise<string | undefined> {
    const conteudo: Record<string, unknown> = {
      shareCommentary: { text: texto },
      shareMediaCategory: link ? 'ARTICLE' : 'NONE',
    };
    if (link) {
      conteudo.media = [{ status: 'READY', originalUrl: link }];
    }

    const resposta = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      {
        author: urn,
        lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': conteudo },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': visibilidade,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      },
    );

    return resposta.headers['x-restli-id'] as string | undefined;
  }
}
