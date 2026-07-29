import { ConfigService } from '@nestjs/config';
import { ChatAuthService } from './chat-auth.service';

/**
 * Sessoes do Chat Web.
 *
 * O ponto critico: a organizacao vem do TOKEN assinado pelo servidor. Se a
 * verificacao de assinatura afrouxar, qualquer pessoa forja um token apontando
 * para a organizacao de outro cliente e le os dados dele.
 */
describe('ChatAuthService', () => {
  const config = {
    get: (chave: string) =>
      chave === 'CHAT_SESSION_SECRET' ? 'segredo-de-teste' : undefined,
  } as unknown as ConfigService;

  const criar = () => new ChatAuthService(config);
  const sessao = { organizationId: 'org-123', userId: 'user-456' };

  it('emite e valida um token, preservando organizacao e usuario', () => {
    const auth = criar();
    expect(auth.validarToken(auth.emitirToken(sessao))).toEqual(sessao);
  });

  it('recusa token vazio ou malformado', () => {
    const auth = criar();
    expect(auth.validarToken(undefined)).toBeUndefined();
    expect(auth.validarToken('')).toBeUndefined();
    expect(auth.validarToken('sem-ponto')).toBeUndefined();
    expect(auth.validarToken('a.b.c.d')).toBeUndefined();
  });

  it('recusa token com assinatura falsa mesmo com payload valido', () => {
    const auth = criar();
    const corpo = Buffer.from(
      JSON.stringify({ org: 'org-de-outro', uid: 'x', exp: Date.now() + 60000 }),
    ).toString('base64url');

    // Este e o ataque real: o invasor sabe montar o payload; o que ele nao tem
    // e o segredo para assinar.
    expect(auth.validarToken(`${corpo}.assinatura-inventada`)).toBeUndefined();
  });

  it('recusa token adulterado depois de assinado', () => {
    const auth = criar();
    const [corpo, assinatura] = auth.emitirToken(sessao).split('.');
    const outroCorpo = Buffer.from(
      JSON.stringify({ org: 'org-invadida', uid: 'x', exp: Date.now() + 60000 }),
    ).toString('base64url');

    expect(auth.validarToken(`${outroCorpo}.${assinatura}`)).toBeUndefined();
  });

  it('recusa token expirado', () => {
    const auth = criar();
    const token = auth.emitirToken(sessao);

    // 13 horas a frente: a validade e de 12.
    const depois = Date.now() + 13 * 3_600_000;
    jest.spyOn(Date, 'now').mockReturnValue(depois);
    expect(auth.validarToken(token)).toBeUndefined();
    jest.restoreAllMocks();
  });

  it('token assinado com outro segredo nao vale', () => {
    const outro = new ChatAuthService({
      get: () => 'segredo-diferente',
    } as unknown as ConfigService);

    expect(criar().validarToken(outro.emitirToken(sessao))).toBeUndefined();
  });

  describe('limite de tentativas', () => {
    it('bloqueia depois de 8 tentativas da mesma origem', () => {
      const auth = criar();
      for (let i = 0; i < 8; i++) {
        expect(auth.podeTentar('1.2.3.4')).toBe(true);
      }
      expect(auth.podeTentar('1.2.3.4')).toBe(false);
    });

    it('nao afeta outras origens', () => {
      const auth = criar();
      for (let i = 0; i < 9; i++) auth.podeTentar('1.2.3.4');
      expect(auth.podeTentar('5.6.7.8')).toBe(true);
    });

    it('login bem-sucedido zera o contador', () => {
      const auth = criar();
      for (let i = 0; i < 8; i++) auth.podeTentar('1.2.3.4');
      auth.limparTentativas('1.2.3.4');
      expect(auth.podeTentar('1.2.3.4')).toBe(true);
    });
  });
});
