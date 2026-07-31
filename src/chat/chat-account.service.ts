import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Contas de acesso ao Chat Web, uma por pessoa, vinculadas a uma organizacao.
 *
 * Substitui a senha unica de instalacao: cada cliente entra com o proprio
 * e-mail e senha, e a organizacao passa a ser resolvida a partir de QUEM
 * entrou — nao de uma variavel de ambiente.
 *
 * Senhas usam scrypt (nativo do Node, sem dependencia externa) com salt
 * aleatorio por usuario. Guardamos apenas o hash.
 */
@Injectable()
export class ChatAccountService {
  private readonly logger = new Logger(ChatAccountService.name);

  /** Custo do scrypt. 2^15 e um meio-termo comum entre seguranca e latencia. */
  private static readonly CUSTO = 32768;
  private static readonly TAMANHO_HASH = 64;

  /**
   * Limite de memoria do scrypt.
   *
   * O Node usa 32 MB por padrao, e `N=32768` com o `r=8` padrao precisa de
   * exatamente 128 * N * r = 32 MB — ou seja, encosta no teto e falha com
   * `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. Damos folga em vez de baixar o custo.
   */
  private static readonly MAX_MEMORIA = 64 * 1024 * 1024;

  constructor(private readonly prisma: PrismaService) {}

  /** Gera o hash no formato `scrypt$<salt-hex>$<hash-hex>`. */
  gerarHash(senha: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(senha, salt, ChatAccountService.TAMANHO_HASH, {
      N: ChatAccountService.CUSTO,
      maxmem: ChatAccountService.MAX_MEMORIA,
    });
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
  }

  /** Confere a senha contra o hash guardado, em tempo constante. */
  conferirSenha(senha: string, guardado?: string | null): boolean {
    if (!guardado) return false;

    const partes = guardado.split('$');
    if (partes.length !== 3 || partes[0] !== 'scrypt') return false;

    try {
      const salt = Buffer.from(partes[1], 'hex');
      const esperado = Buffer.from(partes[2], 'hex');
      const calculado = scryptSync(senha, salt, esperado.length, {
        N: ChatAccountService.CUSTO,
        maxmem: ChatAccountService.MAX_MEMORIA,
      });
      return timingSafeEqual(esperado, calculado);
    } catch {
      return false;
    }
  }

  /** Normaliza o e-mail para servir de chave de login. */
  normalizarEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Usuario com acesso ao chat, pelo e-mail. */
  async buscarPorEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: this.normalizarEmail(email) },
    });
  }

  /**
   * Confere se o usuario do token ainda existe e pertence a organizacao dele,
   * devolvendo tambem a organizacao.
   *
   * Valida porque a conta pode ter sido removida enquanto o token continua
   * valido; devolve a organizacao porque quem chama precisa saber, por exemplo,
   * se ela e de demonstracao — e uma consulta so resolve as duas coisas.
   */
  async carregarSessao(userId: string, organizationId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    if (!user || user.organizationId !== organizationId) return null;
    return { user, organizacao: user.organization };
  }

  /**
   * Cria (ou atualiza a senha de) um acesso ao Chat Web.
   *
   * Se ja existir um usuario com esse e-mail, apenas troca a senha — assim o
   * mesmo comando serve para criar acesso e para resetar senha esquecida.
   */
  async definirAcesso(params: {
    organizationId: string;
    email: string;
    senha: string;
    nome?: string;
  }) {
    const email = this.normalizarEmail(params.email);
    const passwordHash = this.gerarHash(params.senha);

    const existente = await this.prisma.user.findUnique({ where: { email } });
    if (existente) {
      return this.prisma.user.update({
        where: { id: existente.id },
        data: { passwordHash, name: params.nome ?? existente.name },
      });
    }

    return this.prisma.user.create({
      data: {
        organizationId: params.organizationId,
        email,
        passwordHash,
        name: params.nome ?? null,
      },
    });
  }

  /** Marca o ultimo login (util para saber quem esta ativo). */
  async registrarLogin(userId: string): Promise<void> {
    await this.prisma.user
      .update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
      .catch((e) =>
        this.logger.warn(`Falha ao registrar login de ${userId}: ${e?.message}`),
      );
  }
}
