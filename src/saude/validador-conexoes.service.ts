import { Injectable, Logger } from '@nestjs/common';
import { ConnectionsService } from '../connections/connections.service';
import { GoogleService } from '../integrations/google/google.service';
import { InstagramService } from '../integrations/instagram/instagram.service';
import { LinkedinService } from '../integrations/linkedin/linkedin.service';

/** Estado real de uma credencial, conferido contra a API do provedor. */
export type EstadoConexao =
  /** Existe e funciona. */
  | 'ok'
  /** Existe, mas o provedor recusou — precisa reconectar. */
  | 'expirada'
  /** Nao ha credencial guardada. */
  | 'ausente'
  /** Nao deu para saber agora (rede, provedor fora do ar). */
  | 'indeterminada';

export interface Diagnostico {
  provedor: string;
  estado: EstadoConexao;
  /** Frase para o cliente ler na tela. So vem quando ha algo a dizer. */
  detalhe?: string;
}

/**
 * Confere se as credenciais guardadas AINDA funcionam.
 *
 * Por que existe: ate aqui "conectado" significava apenas "existe uma linha no
 * banco". Isso e mentira previsivel — o refresh token do Google emitido com a
 * tela de consentimento em "Testing" expira em 7 dias, e medimos isso tres
 * vezes nesta base. A tela dizia "Conectado" enquanto o painel do cliente
 * mostrava erro, e ninguem ficava sabendo ate alguem reclamar.
 *
 * Verificar custa uma chamada por provedor, entao nunca entra no caminho de
 * uma conversa: so na tela de integracoes (sob demanda) e na checagem diaria.
 */
@Injectable()
export class ValidadorConexoesService {
  private readonly logger = new Logger(ValidadorConexoesService.name);

  /**
   * Teto por verificacao.
   *
   * Provedor lento nao pode segurar a tela do cliente: estourou, o estado vira
   * `indeterminada` — que e honesto, e diferente de "expirada". Acusar
   * expiracao por causa de rede lenta mandaria o cliente refazer um OAuth que
   * estava perfeito.
   */
  private static readonly TIMEOUT_MS = 8000;

  constructor(
    private readonly connections: ConnectionsService,
    private readonly google: GoogleService,
    private readonly instagram: InstagramService,
    private readonly linkedin: LinkedinService,
  ) {}

  /** Provedores que sabemos verificar. Os demais nao entram no diagnostico. */
  private get verificaveis(): Record<
    string,
    { envKey: string; testar: (token: string) => Promise<unknown> }
  > {
    return {
      google: {
        envKey: 'GOOGLE_REFRESH_TOKEN',
        // Troca o refresh token por um access token. E exatamente o passo que
        // falha quando o Google invalida a autorizacao.
        testar: (token) => this.google.authorizedClient(token).getAccessToken(),
      },
      instagram: {
        envKey: 'INSTAGRAM_ACCESS_TOKEN',
        testar: (token) => this.instagram.getPerfil(token),
      },
      linkedin: {
        envKey: 'LINKEDIN_ACCESS_TOKEN',
        // /userinfo e a chamada mais barata que prova que o token vive. O
        // token do LinkedIn vence em ~60 dias e nao tem refresh nas permissoes
        // abertas: sem esta verificacao, o cliente so descobriria ao tentar
        // publicar — e ai o post que ele queria fazer nao sai.
        testar: (token) => this.linkedin.getMembro(token),
      },
    };
  }

  /** Verifica um provedor de uma organizacao. Nunca lanca. */
  async verificar(
    organizationId: string,
    provedor: string,
  ): Promise<Diagnostico> {
    const alvo = this.verificaveis[provedor];
    if (!alvo) return { provedor, estado: 'indeterminada' };

    let token: string | undefined;
    try {
      token = await this.connections.resolveToken(
        { organizationId },
        provedor,
        alvo.envKey,
      );
    } catch {
      // Credencial ilegivel (chave de cifra trocada, registro corrompido).
      return {
        provedor,
        estado: 'expirada',
        detalhe: 'Não consegui ler a credencial guardada. Reconecte para gerar uma nova.',
      };
    }

    if (!token) return { provedor, estado: 'ausente' };

    try {
      await this.comTimeout(alvo.testar(token));
      return { provedor, estado: 'ok' };
    } catch (erro: unknown) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);

      if (ValidadorConexoesService.pareceExpirada(detalhe)) {
        return {
          provedor,
          estado: 'expirada',
          detalhe:
            'A autorização expirou ou foi revogada. Clique em Reconectar para autorizar de novo.',
        };
      }

      this.logger.warn(
        `Verificacao de ${provedor} da organizacao ${organizationId} inconclusiva: ${detalhe}`,
      );
      return {
        provedor,
        estado: 'indeterminada',
        detalhe: 'Não consegui verificar agora. Tente novamente em instantes.',
      };
    }
  }

  /** Verifica todos os provedores conectados por uma organizacao. */
  async verificarTodos(organizationId: string): Promise<Diagnostico[]> {
    const conectados = await this.connections.listProviders(organizationId);
    const alvos = conectados.filter((p) => p in this.verificaveis);

    // Em paralelo: sao chamadas independentes e a tela espera por todas.
    return Promise.all(alvos.map((p) => this.verificar(organizationId, p)));
  }

  /**
   * O erro significa "autorizacao morta" ou "deu ruim agora"?
   *
   * A distincao decide se o cliente e mandado refazer o OAuth. Errar para o
   * lado de `indeterminada` e de proposito: pedir reconexao sem necessidade
   * gasta a paciencia dele e ensina a ignorar o aviso.
   */
  static pareceExpirada(mensagem: string): boolean {
    const m = mensagem.toLowerCase();
    return (
      m.includes('invalid_grant') ||
      m.includes('invalid_token') ||
      m.includes('token has been expired') ||
      m.includes('unauthorized') ||
      m.includes('oauthexception') ||
      m.includes('session has been invalidated') ||
      m.includes('401')
    );
  }

  /**
   * Corrida entre a chamada e o relogio.
   *
   * O `clearTimeout` no `finally` nao e detalhe: sem ele, toda verificacao
   * bem-sucedida deixa um timer de 8 segundos vivo. Em producao isso segura o
   * desligamento limpo do processo, e num teste faz o Jest nao encerrar — foi
   * assim que o vazamento apareceu.
   */
  private async comTimeout<T>(promessa: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promessa,
        new Promise<T>((_, rejeitar) => {
          timer = setTimeout(
            () => rejeitar(new Error('tempo esgotado na verificacao')),
            ValidadorConexoesService.TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
