import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ChatAccountService } from './chat-account.service';

/** Conta recem-criada, ja pronta para receber uma sessao. */
export interface ContaCriada {
  userId: string;
  organizationId: string;
  nome: string | null;
}

/**
 * Autocadastro publico: /criar-conta.
 *
 * Diferente do convite, aqui NAO ha ninguem selecionando quem entra — a rota
 * fica aberta na internet. Isso troca controle por alcance, e a troca so e
 * aceitavel com duas travas, ambas obrigatorias:
 *
 * 1. A rota pode ser DESLIGADA por variavel de ambiente. Se aparecer abuso,
 *    voce derruba o cadastro em um deploy, sem mexer em codigo.
 * 2. Toda organizacao criada aqui nasce com TETO DE MENSAGENS. Sem ele, quem
 *    descobrisse a URL gastaria a chave da Anthropic ate o credito acabar — e
 *    a conta apareceria depois, na fatura.
 *
 * O limite nao existe para punir o visitante: ele existe porque cada mensagem
 * custa dinheiro real de quem mantem o servico. Ao estourar, a pessoa continua
 * com a conta e os dados dela, e e convidada a falar com voce.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  /** Mesma regra do convite: nao aceitar senha que nao protege nada. */
  static readonly SENHA_MINIMA = 8;

  private static readonly FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Teto padrao quando KYRIUS_AUTOCADASTRO_LIMITE nao esta configurado. */
  private static readonly LIMITE_PADRAO = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly contas: ChatAccountService,
  ) {}

  /**
   * A rota publica esta ligada?
   *
   * Fail-closed: qualquer valor diferente de "true" mantem o cadastro
   * fechado. Um autocadastro que abre por engano — variavel vazia, typo,
   * `.env` incompleto no servidor novo — expoe a chave de IA; um que fica
   * fechado por engano so faz voce mandar um convite.
   */
  get habilitado(): boolean {
    return (
      (this.config.get<string>('KYRIUS_AUTOCADASTRO') ?? '')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  /**
   * Teto de mensagens das contas criadas por esta rota. `null` = sem teto.
   *
   * "Sem teto" exige a palavra `ilimitado`, escrita por extenso. Nao e
   * frescura: variavel ausente, vazia, com typo ou com `0` cai no padrao,
   * nunca em ilimitado. O modo que expoe a chave de IA precisa ser escolhido
   * de proposito — um `.env` incompleto no servidor novo nao pode abrir isso
   * sozinho.
   */
  get limite(): number | null {
    const bruto = (this.config.get<string>('KYRIUS_AUTOCADASTRO_LIMITE') ?? '')
      .trim()
      .toLowerCase();

    if (bruto === 'ilimitado') return null;

    const numero = Number(bruto);
    return Number.isFinite(numero) && numero > 0
      ? Math.floor(numero)
      : SignupService.LIMITE_PADRAO;
  }

  /**
   * Cria organizacao + conta em uma transacao.
   *
   * Transacao porque uma organizacao sem usuario e lixo invisivel no banco, e
   * um usuario sem organizacao nao consegue nem abrir o chat.
   */
  async criar(dados: {
    email?: string;
    senha?: string;
    nome?: string;
    empresa?: string;
  }): Promise<ContaCriada> {
    if (!this.habilitado) {
      throw new Error('O cadastro aberto esta desativado.');
    }

    const email = this.contas.normalizarEmail(dados.email ?? '');
    if (!email || !SignupService.FORMATO_EMAIL.test(email)) {
      throw new Error('Informe um e-mail valido.');
    }

    const senha = dados.senha ?? '';
    if (senha.length < SignupService.SENHA_MINIMA) {
      throw new Error(
        `A senha precisa ter ao menos ${SignupService.SENHA_MINIMA} caracteres.`,
      );
    }

    const empresa = dados.empresa?.trim();
    if (!empresa) {
      throw new Error('Informe o nome da sua empresa.');
    }

    const passwordHash = this.contas.gerarHash(senha);
    const limiteInteracoes = this.limite;

    return this.prisma.$transaction(async (tx) => {
      // Dentro da transacao: dois envios simultaneos do formulario passariam
      // por uma checagem feita fora dela, e o segundo estouraria com erro cru
      // de banco — que o visitante leria como "deu errado, tenta de novo".
      const ocupado = await tx.user.findUnique({ where: { email } });
      if (ocupado) {
        throw new Error(
          'Ja existe uma conta com este e-mail. Entre em vez de criar outra.',
        );
      }

      const org = await tx.organization.create({
        data: { name: empresa, autocadastro: true, limiteInteracoes },
      });

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          email,
          passwordHash,
          name: dados.nome?.trim() || null,
        },
      });

      this.logger.log(
        `Autocadastro: "${empresa}" (${email}) — org ${org.id}, teto ${limiteInteracoes}.`,
      );
      return { userId: user.id, organizationId: org.id, nome: user.name };
    });
  }
}
