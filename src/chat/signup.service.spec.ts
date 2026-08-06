import { ConfigService } from '@nestjs/config';
import { SignupService } from './signup.service';
import { ChatAccountService } from './chat-account.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cadastro aberto (/criar-conta).
 *
 * Esta rota fica exposta na internet e cada conta criada por ela consome a
 * chave de IA de quem mantem o servico. Os dois testes que nao podem falhar
 * sao: a rota so liga com o valor exato "true" (fail-closed), e toda conta
 * nasce com teto de mensagens. Se qualquer um dos dois quebrar, o prejuizo
 * aparece na fatura, nao no log.
 */
describe('SignupService (cadastro aberto)', () => {
  const montar = (env: Record<string, string | undefined>, emailOcupado?: string) => {
    const criadas: { org: Record<string, unknown>; user: Record<string, unknown> }[] = [];

    const tx = {
      user: {
        findUnique: jest.fn(({ where }: { where: { email: string } }) =>
          Promise.resolve(where.email === emailOcupado ? { id: 'u0' } : null),
        ),
        create: jest.fn((a: { data: Record<string, unknown> }) => {
          criadas[criadas.length - 1].user = a.data;
          return Promise.resolve({ id: 'user-1', name: a.data.name ?? null });
        }),
      },
      organization: {
        create: jest.fn((a: { data: Record<string, unknown> }) => {
          criadas.push({ org: a.data, user: {} });
          return Promise.resolve({ id: 'org-1' });
        }),
      },
    };

    const prisma = {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as unknown as PrismaService;

    const contas = {
      normalizarEmail: (e: string) => e.trim().toLowerCase(),
      gerarHash: () => 'hash-falso',
    } as unknown as ChatAccountService;

    const config = { get: (k: string) => env[k] } as unknown as ConfigService;

    return { servico: new SignupService(prisma, config, contas), criadas, tx };
  };

  const validos = {
    empresa: 'Mercearia Boa Vista',
    email: 'ana@mercearia.com.br',
    senha: 'senha-de-teste',
  };

  describe('interruptor (fail-closed)', () => {
    it.each([
      ['ausente', undefined],
      ['vazio', ''],
      ['false', 'false'],
      ['1', '1'],
      ['sim', 'sim'],
      ['TRUE com espacos vira valido, mas "truee" nao', 'truee'],
    ])('fica DESLIGADO quando KATALLI_AUTOCADASTRO=%s', async (_c, valor) => {
      const { servico } = montar({ KATALLI_AUTOCADASTRO: valor as string });
      expect(servico.habilitado).toBe(false);
      await expect(servico.criar(validos)).rejects.toThrow(/desativado/i);
    });

    it.each(['true', 'TRUE', ' true '])('liga com %s', (valor) => {
      expect(montar({ KATALLI_AUTOCADASTRO: valor }).servico.habilitado).toBe(true);
    });
  });

  describe('teto de mensagens', () => {
    it('toda conta criada aqui nasce com limite', async () => {
      const { servico, criadas } = montar({
        KATALLI_AUTOCADASTRO: 'true',
        KATALLI_AUTOCADASTRO_LIMITE: '30',
      });

      await servico.criar(validos);

      expect(criadas[0].org).toMatchObject({
        autocadastro: true,
        limiteInteracoes: 30,
      });
    });

    it.each([
      ['ausente', undefined],
      ['vazio', ''],
      ['texto', 'muitas'],
      ['zero', '0'],
      ['negativo', '-5'],
      ['quase a palavra certa', 'ilimitados'],
    ])('cai no padrao de 20 quando o limite e %s', (_c, valor) => {
      const { servico } = montar({
        KATALLI_AUTOCADASTRO: 'true',
        KATALLI_AUTOCADASTRO_LIMITE: valor as string,
      });
      // Config quebrada NUNCA pode virar ilimitado: seria abrir a chave de IA
      // por engano, e o erro so apareceria na fatura.
      expect(servico.limite).toBe(20);
    });

    it.each(['ilimitado', 'ILIMITADO', ' ilimitado '])(
      'aceita "sem teto" so quando escrito por extenso: %s',
      (valor) => {
        const { servico } = montar({
          KATALLI_AUTOCADASTRO: 'true',
          KATALLI_AUTOCADASTRO_LIMITE: valor,
        });
        expect(servico.limite).toBeNull();
      },
    );

    it('conta sem teto nasce com limiteInteracoes nulo', async () => {
      const { servico, criadas } = montar({
        KATALLI_AUTOCADASTRO: 'true',
        KATALLI_AUTOCADASTRO_LIMITE: 'ilimitado',
      });

      await servico.criar(validos);

      // `null` e o mesmo valor das contas criadas por convite: o chat nao
      // aplica trava nenhuma.
      expect(criadas[0].org).toMatchObject({
        autocadastro: true,
        limiteInteracoes: null,
      });
    });
  });

  describe('validacao dos dados', () => {
    const ligado = { KATALLI_AUTOCADASTRO: 'true' };

    it.each([
      ['e-mail sem arroba', { ...validos, email: 'sem-arroba' }, /e-mail valido/i],
      ['e-mail vazio', { ...validos, email: '' }, /e-mail valido/i],
      ['senha curta', { ...validos, senha: '1234' }, /ao menos 8/i],
      ['empresa vazia', { ...validos, empresa: '   ' }, /nome da sua empresa/i],
    ])('recusa %s', async (_c, dados, esperado) => {
      const { servico, tx } = montar(ligado);
      await expect(servico.criar(dados)).rejects.toThrow(esperado);
      expect(tx.organization.create).not.toHaveBeenCalled();
    });

    it('normaliza o e-mail antes de gravar', async () => {
      const { servico, criadas } = montar(ligado);
      await servico.criar({ ...validos, email: '  Ana@Mercearia.COM.BR ' });
      expect(criadas[0].user.email).toBe('ana@mercearia.com.br');
    });

    it('recusa e-mail ja cadastrado, checando dentro da transacao', async () => {
      const { servico, tx } = montar(ligado, 'ana@mercearia.com.br');
      await expect(servico.criar(validos)).rejects.toThrow(/ja existe uma conta/i);
      expect(tx.user.findUnique).toHaveBeenCalled();
      expect(tx.organization.create).not.toHaveBeenCalled();
    });
  });
});
