import { carregarChave, cifrar, decifrar, estaCifrado } from './credentials-crypto';

/**
 * Criptografia das credenciais dos clientes.
 *
 * O que estes testes protegem: se alguem "simplificar" este arquivo e a cifra
 * parar de cifrar, nada quebra visivelmente — o produto continua funcionando e
 * as credenciais passam a ir em claro para o banco. So um teste pega isso.
 */
describe('credentials-crypto', () => {
  const chave = carregarChave('a'.repeat(64))!;

  describe('carregarChave', () => {
    it('aceita 64 caracteres hex', () => {
      expect(carregarChave('0'.repeat(64))).toHaveLength(32);
    });

    it('recusa chave ausente, curta ou nao-hex', () => {
      expect(carregarChave(undefined)).toBeUndefined();
      expect(carregarChave('')).toBeUndefined();
      expect(carregarChave('abc')).toBeUndefined();
      expect(carregarChave('z'.repeat(64))).toBeUndefined();
    });
  });

  it('o texto cifrado nao contem o segredo original', () => {
    const envelope = cifrar({ token: 'sk_live_segredo_do_cliente' }, chave);
    expect(envelope.enc).not.toContain('sk_live_segredo_do_cliente');
    expect(JSON.stringify(envelope)).not.toContain('segredo');
  });

  it('decifra de volta ao valor original', () => {
    const original = { token: 'pat-na1-abc', extra: 42 };
    expect(decifrar(cifrar(original, chave), chave)).toEqual(original);
  });

  it('cifrar duas vezes o mesmo valor gera saidas diferentes (IV por registro)', () => {
    const a = cifrar({ token: 'igual' }, chave);
    const b = cifrar({ token: 'igual' }, chave);
    // Sem isso, daria para saber que duas organizacoes usam a mesma credencial
    // apenas olhando a tabela.
    expect(a.enc).not.toEqual(b.enc);
  });

  it('falha ao decifrar com a chave errada', () => {
    const envelope = cifrar({ token: 'x' }, chave);
    const outraChave = carregarChave('b'.repeat(64))!;
    expect(() => decifrar(envelope, outraChave)).toThrow();
  });

  it('detecta adulteracao do dado cifrado (tag de autenticacao)', () => {
    const envelope = cifrar({ token: 'x' }, chave);
    const [iv, tag, dados] = envelope.enc.split(':');
    const alterado = { ...envelope, enc: `${iv}:${tag}:${dados.slice(0, -4)}AAAA` };
    // GCM autentica: dado mexido no banco falha alto em vez de virar lixo.
    expect(() => decifrar(alterado, chave)).toThrow();
  });

  it('recusa envelope malformado', () => {
    expect(() => decifrar({ v: 1, enc: 'so-uma-parte' }, chave)).toThrow();
  });

  describe('estaCifrado', () => {
    it('reconhece o envelope', () => {
      expect(estaCifrado(cifrar({ token: 'x' }, chave))).toBe(true);
    });

    it('reconhece registro legado em texto plano', () => {
      // A leitura precisa aceitar registros antigos durante a migracao.
      expect(estaCifrado({ token: 'em-claro' })).toBe(false);
      expect(estaCifrado(null)).toBe(false);
      expect(estaCifrado(undefined)).toBe(false);
    });
  });
});
