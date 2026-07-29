import { ChatAccountService } from './chat-account.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Senhas das contas de acesso.
 *
 * Um destes testes existe por causa de um bug real: `scrypt` com N=32768 estoura
 * o limite de memoria padrao do Node (32 MB) e lanca
 * ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Passou despercebido ate um usuario tentar
 * criar a senha. Agora falha aqui, em milissegundos.
 */
describe('ChatAccountService', () => {
  const contas = new ChatAccountService({} as PrismaService);

  it('gera hash sem estourar o limite de memoria do scrypt', () => {
    // O bug original: RangeError "memory limit exceeded".
    expect(() => contas.gerarHash('qualquer-senha')).not.toThrow();
  });

  it('o hash nao contem a senha', () => {
    const hash = contas.gerarHash('minha-senha-secreta');
    expect(hash).not.toContain('minha-senha-secreta');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('confere a senha correta', () => {
    const hash = contas.gerarHash('senha-do-cliente');
    expect(contas.conferirSenha('senha-do-cliente', hash)).toBe(true);
  });

  it('recusa senha errada, inclusive por um caractere', () => {
    const hash = contas.gerarHash('senha-do-cliente');
    expect(contas.conferirSenha('senha-do-clientE', hash)).toBe(false);
    expect(contas.conferirSenha('', hash)).toBe(false);
    expect(contas.conferirSenha('outra', hash)).toBe(false);
  });

  it('a mesma senha gera hashes diferentes (salt por usuario)', () => {
    // Sem salt proprio, dois clientes com a mesma senha teriam o mesmo hash —
    // e quebrar um quebraria os dois.
    const a = contas.gerarHash('igual');
    const b = contas.gerarHash('igual');
    expect(a).not.toEqual(b);
    expect(contas.conferirSenha('igual', a)).toBe(true);
    expect(contas.conferirSenha('igual', b)).toBe(true);
  });

  it('recusa hash ausente ou em formato desconhecido', () => {
    expect(contas.conferirSenha('x', null)).toBe(false);
    expect(contas.conferirSenha('x', undefined)).toBe(false);
    expect(contas.conferirSenha('x', 'texto-solto')).toBe(false);
    expect(contas.conferirSenha('x', 'bcrypt$abc$def')).toBe(false);
  });

  it('normaliza e-mail para servir de chave de login', () => {
    // Senao o cliente que digita "Dono@Empresa.com" nao encontra a conta.
    expect(contas.normalizarEmail('  Dono@Empresa.COM ')).toBe('dono@empresa.com');
  });
});
