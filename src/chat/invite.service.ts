import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChatAccountService } from './chat-account.service';

/** Convite validado, pronto para ser exibido na tela de aceite. */
export interface ConviteValido {
  id: string;
  /** `null` em convite ABERTO — a tela pede o e-mail ao cliente. */
  email: string | null;
  organizationId: string | null;
  companyName: string | null;
}

/** Resultado do aceite: a conta criada e a organizacao dela. */
export interface ConviteAceito {
  userId: string;
  organizationId: string;
  nome: string | null;
}

/**
 * Convites de acesso ao Chat Web.
 *
 * O fluxo troca "o dono do Kyrius cria a senha do cliente" por "o cliente
 * define a propria senha a partir de um link". Isso tira a credencial das maos
 * de quem vende e do historico do terminal.
 *
 * O token so existe em claro dentro do link; no banco fica o SHA-256 dele.
 * Hash simples (sem salt) e adequado aqui porque o token ja e aleatorio de
 * 256 bits — nao ha o que adivinhar, diferente de uma senha escolhida por
 * humano, que precisa de scrypt.
 */
@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  /** Validade do convite. Curta de proposito: link antigo vira link morto. */
  private static readonly VALIDADE_DIAS = 7;

  /** Tamanho minimo da senha escolhida pelo cliente. */
  static readonly SENHA_MINIMA = 8;

  /**
   * Formato aceito de e-mail. Proposital ser permissivo: a validacao rigorosa
   * de e-mail e impossivel por regex e recusar um endereco valido custa um
   * cliente. Basta impedir entrada obviamente quebrada.
   */
  private static readonly FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly contas: ChatAccountService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Monta o link completo a partir da base publica configurada. */
  linkDe(token: string): string {
    const base = (
      this.config.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/convite?token=${token}`;
  }

  /**
   * Cria um convite e devolve o token em claro — esta e a UNICA vez que ele
   * existe fora do link. Informe `organizationId` para adicionar alguem a uma
   * empresa existente, ou `companyName` para criar uma empresa nova no aceite.
   *
   * Sem `email`, o convite nasce ABERTO: quem abrir o link informa o proprio
   * endereco. Util para mandar por WhatsApp sem saber qual e-mail a pessoa
   * usa — em troca, o link serve para qualquer um que o receba.
   */
  async criar(params: {
    email?: string;
    companyName?: string;
    organizationId?: string;
  }): Promise<{ token: string; link: string; expiresAt: Date }> {
    const email = params.email
      ? this.contas.normalizarEmail(params.email)
      : null;

    if (email) {
      if (!InviteService.FORMATO_EMAIL.test(email)) {
        throw new Error(`E-mail invalido: ${email}`);
      }
      // So da para conferir agora quando o e-mail ja e conhecido. No convite
      // aberto, a checagem acontece no aceite.
      const jaExiste = await this.contas.buscarPorEmail(email);
      if (jaExiste) {
        throw new Error(
          `Ja existe um acesso para ${email}. Use o script de acesso para trocar a senha.`,
        );
      }
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + InviteService.VALIDADE_DIAS);

    await this.prisma.invite.create({
      data: {
        tokenHash: this.hash(token),
        email,
        organizationId: params.organizationId ?? null,
        companyName: params.companyName ?? null,
        expiresAt,
      },
    });

    this.logger.log(
      email ? `Convite criado para ${email}.` : 'Convite aberto criado.',
    );
    return { token, link: this.linkDe(token), expiresAt };
  }

  /** Devolve o convite se o token for valido, nao usado e nao expirado. */
  async validar(token?: string): Promise<ConviteValido | undefined> {
    if (!token) return undefined;

    const convite = await this.prisma.invite.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!convite) return undefined;
    if (convite.usedAt) return undefined;
    if (convite.expiresAt.getTime() < Date.now()) return undefined;

    return {
      id: convite.id,
      email: convite.email,
      organizationId: convite.organizationId,
      companyName: convite.companyName,
    };
  }

  /**
   * Aceita o convite: cria a organizacao (quando for o caso), a conta com a
   * senha escolhida pelo cliente, e queima o convite.
   *
   * Tudo em uma transacao — um convite consumido sem conta criada deixaria o
   * cliente sem acesso e sem poder tentar de novo.
   */
  async aceitar(
    token: string,
    dados: { senha: string; nome?: string; email?: string },
  ): Promise<ConviteAceito> {
    const convite = await this.validar(token);
    if (!convite) throw new Error('Convite invalido, expirado ou ja utilizado.');

    if (!dados.senha || dados.senha.length < InviteService.SENHA_MINIMA) {
      throw new Error(
        `A senha precisa ter ao menos ${InviteService.SENHA_MINIMA} caracteres.`,
      );
    }

    // O e-mail do CONVITE tem precedencia absoluta sobre o que vem do
    // navegador. Sem isso, um convite direcionado a uma pessoa poderia ser
    // usado para abrir conta com outro endereco — bastaria editar o campo no
    // DevTools. O cliente so escolhe o e-mail quando o convite e aberto.
    const email = convite.email ?? this.normalizarEmailInformado(dados.email);
    const passwordHash = this.contas.gerarHash(dados.senha);

    return this.prisma.$transaction(async (tx) => {
      // Reconfere dentro da transacao: dois cliques no botao nao podem
      // consumir o mesmo convite duas vezes.
      const atual = await tx.invite.findUnique({ where: { id: convite.id } });
      if (!atual || atual.usedAt) {
        throw new Error('Convite invalido, expirado ou ja utilizado.');
      }

      // Em convite aberto, o e-mail so aparece agora — a unicidade precisa ser
      // conferida DENTRO da transacao. Fora dela, dois aceites simultaneos
      // passariam pela checagem e o segundo estouraria com erro de banco, que
      // o cliente veria como falha generica.
      const ocupado = await tx.user.findUnique({ where: { email } });
      if (ocupado) {
        throw new Error(
          `Ja existe uma conta com o e-mail ${email}. Faca login em vez de criar outra.`,
        );
      }

      let organizationId = convite.organizationId;
      if (!organizationId) {
        const org = await tx.organization.create({
          data: { name: convite.companyName ?? email },
        });
        organizationId = org.id;
      }

      const user = await tx.user.create({
        data: {
          organizationId,
          email,
          passwordHash,
          name: dados.nome?.trim() || null,
        },
      });

      await tx.invite.update({
        where: { id: convite.id },
        data: { usedAt: new Date() },
      });

      this.logger.log(
        `Convite aceito por ${email}: org ${organizationId}, user ${user.id}.`,
      );
      return { userId: user.id, organizationId, nome: user.name };
    });
  }

  /** Valida e normaliza o e-mail digitado pelo cliente no convite aberto. */
  private normalizarEmailInformado(bruto?: string): string {
    const email = this.contas.normalizarEmail(bruto ?? '');
    if (!email) throw new Error('Informe o seu e-mail.');
    if (!InviteService.FORMATO_EMAIL.test(email)) {
      throw new Error('E-mail invalido. Confira e tente de novo.');
    }
    return email;
  }
}
