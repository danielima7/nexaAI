import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

/** Identidade extraida de um token de sessao valido. */
export interface SessaoChat {
  organizationId: string;
  userId: string;
}

/**
 * Sessoes do Chat Web.
 *
 * O acesso e por CONTA (e-mail + senha, ver ChatAccountService), nao mais por
 * uma senha unica de instalacao. Ao autenticar, emitimos um token assinado
 * (HMAC-SHA256) que carrega a organizacao e o usuario — assim a identidade vem
 * do servidor, nunca de um identificador escolhido pelo navegador.
 */
@Injectable()
export class ChatAuthService implements OnModuleInit {
  private readonly logger = new Logger(ChatAuthService.name);

  /** Validade do token de sessao. */
  private static readonly VALIDADE_HORAS = 12;

  /** Limite de tentativas de login por origem, e a janela em minutos. */
  private static readonly MAX_TENTATIVAS = 8;
  private static readonly JANELA_MINUTOS = 15;

  /**
   * Tentativas de login por IP. Em memoria de proposito: e um freio contra
   * forca bruta caseira, nao um rate limit distribuido. Com mais de uma
   * instancia, isto precisa ir para o Redis.
   */
  private readonly tentativas = new Map<
    string,
    { contador: number; reiniciaEm: number }
  >();

  /** Segredo de assinatura gerado em memoria quando nao ha um no .env. */
  private segredoVolatil?: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (!this.config.get<string>('CHAT_SESSION_SECRET')?.trim()) {
      this.logger.warn(
        'CHAT_SESSION_SECRET ausente: usando um segredo volatil. As sessoes do ' +
          'chat serao invalidadas a cada reinicio. Defina a variavel no .env.',
      );
    }
  }

  /**
   * Segredo usado para assinar os tokens. Sem um no .env, geramos um aleatorio
   * em memoria: o chat continua funcionando, mas as sessoes morrem no proximo
   * restart — degradacao visivel, nunca insegura.
   */
  private segredo(): Buffer {
    const doEnv = this.config.get<string>('CHAT_SESSION_SECRET')?.trim();
    if (doEnv) return Buffer.from(doEnv, 'utf8');
    if (!this.segredoVolatil) this.segredoVolatil = randomBytes(32);
    return this.segredoVolatil;
  }

  /** Comparacao de strings resistente a ataque de tempo. */
  private iguais(a: string, b: string): boolean {
    const hashA = createHmac('sha256', 'cmp').update(a, 'utf8').digest();
    const hashB = createHmac('sha256', 'cmp').update(b, 'utf8').digest();
    return timingSafeEqual(hashA, hashB);
  }

  /**
   * Registra uma tentativa de login e diz se a origem ainda pode tentar.
   * Chamado ANTES de conferir a senha.
   */
  podeTentar(origem: string): boolean {
    const agora = Date.now();
    const atual = this.tentativas.get(origem);

    if (!atual || agora > atual.reiniciaEm) {
      this.tentativas.set(origem, {
        contador: 1,
        reiniciaEm: agora + ChatAuthService.JANELA_MINUTOS * 60_000,
      });
      return true;
    }

    atual.contador++;
    if (atual.contador > ChatAuthService.MAX_TENTATIVAS) {
      this.logger.warn(
        `Bloqueando tentativas de login do chat vindas de ${origem} ` +
          `(${atual.contador} na janela de ${ChatAuthService.JANELA_MINUTOS} min).`,
      );
      return false;
    }
    return true;
  }

  /** Zera o contador de uma origem apos login bem-sucedido. */
  limparTentativas(origem: string): void {
    this.tentativas.delete(origem);
  }

  /** Emite um token de sessao assinado, carregando organizacao e usuario. */
  emitirToken(sessao: SessaoChat): string {
    const payload = {
      org: sessao.organizationId,
      uid: sessao.userId,
      exp: Date.now() + ChatAuthService.VALIDADE_HORAS * 3_600_000,
    };
    const corpo = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const assinatura = createHmac('sha256', this.segredo())
      .update(corpo)
      .digest('base64url');
    return `${corpo}.${assinatura}`;
  }

  /**
   * Valida o token e devolve organizacao + usuario.
   * `undefined` se invalido, adulterado ou expirado.
   */
  validarToken(token?: string): SessaoChat | undefined {
    if (!token) return undefined;

    const [corpo, assinatura] = token.split('.');
    if (!corpo || !assinatura) return undefined;

    const esperada = createHmac('sha256', this.segredo())
      .update(corpo)
      .digest('base64url');

    // Assinatura conferida antes de olhar o conteudo: nunca confie no payload
    // de um token que ainda nao foi verificado.
    if (!this.iguais(assinatura, esperada)) return undefined;

    try {
      const payload = JSON.parse(
        Buffer.from(corpo, 'base64url').toString('utf8'),
      );
      if (typeof payload?.exp !== 'number' || Date.now() > payload.exp) {
        return undefined;
      }
      if (typeof payload.org !== 'string' || typeof payload.uid !== 'string') {
        return undefined;
      }
      return { organizationId: payload.org, userId: payload.uid };
    } catch {
      return undefined;
    }
  }
}
