import { ConfigService } from '@nestjs/config';
import { InviteService } from './invite.service';
import { ChatAccountService } from './chat-account.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Convites de acesso, nos dois modos.
 *
 * O teste que mais importa aqui e o primeiro: num convite DIRECIONADO, o
 * e-mail vem do convite e nao do navegador. A tela desabilita o campo, mas
 * isso e so conveniencia — qualquer pessoa reabilita pelo DevTools e envia
 * outro endereco. Se o servico confiasse no que chega do cliente, um convite
 * enviado ao Joao viraria conta da Maria, e o controle de quem entra no
 * produto deixaria de existir.
 */
describe('InviteService (convite direcionado x aberto)', () => {
  const CONVITE_ID = 'convite-1';

  interface Estado {
    emailDoConvite: string | null;
    usedAt: Date | null;
    emailJaCadastrado?: string;
  }

  const montar = (estado: Estado) => {
    const criados: { email: string; organizationId: string }[] = [];

    const registro = {
      id: CONVITE_ID,
      email: estado.emailDoConvite,
      organizationId: null,
      companyName: 'Empresa Teste',
      usedAt: estado.usedAt,
      expiresAt: new Date(Date.now() + 86_400_000),
    };

    const tx = {
      invite: {
        findUnique: jest.fn().mockResolvedValue(registro),
        update: jest.fn().mockResolvedValue(registro),
        create: jest.fn().mockResolvedValue(registro),
      },
      user: {
        findUnique: jest.fn(({ where }: { where: { email: string } }) =>
          Promise.resolve(
            where.email === estado.emailJaCadastrado ? { id: 'u0' } : null,
          ),
        ),
        create: jest.fn((args: { data: { email: string; organizationId: string } }) => {
          criados.push(args.data);
          return Promise.resolve({ id: 'user-1', name: null, ...args.data });
        }),
      },
      organization: {
        create: jest.fn().mockResolvedValue({ id: 'org-1' }),
      },
    };

    const prisma = {
      invite: tx.invite,
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as unknown as PrismaService;

    const contas = {
      normalizarEmail: (e: string) => e.trim().toLowerCase(),
      buscarPorEmail: jest.fn().mockResolvedValue(null),
      gerarHash: () => 'hash-falso',
    } as unknown as ChatAccountService;

    const config = { get: () => 'http://localhost:3000' } as unknown as ConfigService;

    return { servico: new InviteService(prisma, config, contas), criados, tx };
  };

  describe('convite DIRECIONADO', () => {
    it('ignora o e-mail vindo do navegador e usa o do convite', async () => {
      const { servico, criados } = montar({
        emailDoConvite: 'joao@empresa.com',
        usedAt: null,
      });

      await servico.aceitar('tok', {
        senha: 'senha-bem-grande',
        email: 'invasor@outro.com', // tentativa de trocar o destinatario
      });

      expect(criados[0].email).toBe('joao@empresa.com');
    });

    it('nao exige e-mail no corpo — a tela envia o campo desabilitado', async () => {
      const { servico, criados } = montar({
        emailDoConvite: 'joao@empresa.com',
        usedAt: null,
      });

      await servico.aceitar('tok', { senha: 'senha-bem-grande' });

      expect(criados[0].email).toBe('joao@empresa.com');
    });
  });

  describe('convite ABERTO', () => {
    it('usa o e-mail informado pelo cliente', async () => {
      const { servico, criados } = montar({ emailDoConvite: null, usedAt: null });

      await servico.aceitar('tok', {
        senha: 'senha-bem-grande',
        email: '  Maria@Empresa.COM  ',
      });

      // Normalizado: sem espacos e em minusculas.
      expect(criados[0].email).toBe('maria@empresa.com');
    });

    it('recusa quando o cliente nao informa e-mail', async () => {
      const { servico } = montar({ emailDoConvite: null, usedAt: null });

      await expect(
        servico.aceitar('tok', { senha: 'senha-bem-grande' }),
      ).rejects.toThrow(/informe o seu e-mail/i);
    });

    it('recusa e-mail com formato invalido', async () => {
      const { servico } = montar({ emailDoConvite: null, usedAt: null });

      await expect(
        servico.aceitar('tok', { senha: 'senha-bem-grande', email: 'sem-arroba' }),
      ).rejects.toThrow(/invalido/i);
    });

    it('recusa e-mail que ja tem conta, checando DENTRO da transacao', async () => {
      const { servico, tx } = montar({
        emailDoConvite: null,
        usedAt: null,
        emailJaCadastrado: 'repetido@empresa.com',
      });

      await expect(
        servico.aceitar('tok', {
          senha: 'senha-bem-grande',
          email: 'repetido@empresa.com',
        }),
      ).rejects.toThrow(/ja existe uma conta/i);

      // A checagem tem de acontecer no `tx`, senao dois aceites simultaneos
      // passariam e o segundo estouraria com erro cru de banco.
      expect(tx.user.findUnique).toHaveBeenCalled();
      expect(tx.user.create).not.toHaveBeenCalled();
    });
  });

  describe('regras que valem nos dois modos', () => {
    it('recusa senha curta antes de tocar no banco', async () => {
      const { servico, tx } = montar({
        emailDoConvite: 'joao@empresa.com',
        usedAt: null,
      });

      await expect(
        servico.aceitar('tok', { senha: '1234' }),
      ).rejects.toThrow(/ao menos 8/i);

      expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('recusa convite ja utilizado', async () => {
      const { servico } = montar({
        emailDoConvite: 'joao@empresa.com',
        usedAt: new Date(),
      });

      await expect(
        servico.aceitar('tok', { senha: 'senha-bem-grande' }),
      ).rejects.toThrow(/invalido, expirado ou ja utilizado/i);
    });
  });
});
