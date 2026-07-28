import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Criptografia das credenciais das integracoes (Connection.credentials).
 *
 * Algoritmo: AES-256-GCM — cifra e autentica ao mesmo tempo. A tag de
 * autenticacao faz a decifragem FALHAR se o dado tiver sido adulterado no
 * banco, em vez de devolver lixo silenciosamente.
 *
 * Cada registro usa um IV aleatorio proprio: cifrar o mesmo token duas vezes
 * produz saidas diferentes, entao ninguem descobre que duas organizacoes usam
 * a mesma credencial so olhando a tabela.
 *
 * Formato guardado (continua sendo Json valido, como a coluna exige):
 *   { "v": 1, "enc": "<iv-base64>:<tag-base64>:<cifra-base64>" }
 */

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12; // 96 bits: recomendado para GCM
const VERSAO_ATUAL = 1;

/**
 * Envelope guardado no banco no lugar das credenciais em claro.
 *
 * A index signature existe para o Prisma aceitar o objeto como `InputJsonObject`
 * na coluna Json — sem ela o tipo nao e considerado um objeto JSON valido.
 */
export interface CredenciaisCifradas {
  v: number;
  enc: string;
  [campo: string]: string | number;
}

/**
 * Converte a chave do .env em bytes. Aceita 64 caracteres hex (32 bytes).
 * Retorna `undefined` se ausente ou malformada — quem chama decide o que fazer.
 */
export function carregarChave(raw?: string): Buffer | undefined {
  const valor = raw?.trim();
  if (!valor) return undefined;
  if (!/^[0-9a-f]{64}$/i.test(valor)) return undefined;
  return Buffer.from(valor, 'hex');
}

/** O valor lido do banco ja esta cifrado? */
export function estaCifrado(valor: any): valor is CredenciaisCifradas {
  return (
    !!valor &&
    typeof valor === 'object' &&
    typeof valor.enc === 'string' &&
    typeof valor.v === 'number'
  );
}

/** Cifra um objeto de credenciais. */
export function cifrar(
  credenciais: Record<string, any>,
  chave: Buffer,
): CredenciaisCifradas {
  const iv = randomBytes(TAMANHO_IV);
  const cipher = createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([
    cipher.update(JSON.stringify(credenciais), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    v: VERSAO_ATUAL,
    enc: [
      iv.toString('base64'),
      tag.toString('base64'),
      dados.toString('base64'),
    ].join(':'),
  };
}

/**
 * Decifra o envelope. Lanca se a chave estiver errada ou o dado adulterado —
 * falhar alto e melhor do que seguir com credencial corrompida.
 */
export function decifrar(
  envelope: CredenciaisCifradas,
  chave: Buffer,
): Record<string, any> {
  const partes = envelope.enc.split(':');
  if (partes.length !== 3) {
    throw new Error('Envelope de credenciais malformado.');
  }
  const [iv, tag, dados] = partes.map((p) => Buffer.from(p, 'base64'));

  const decipher = createDecipheriv(ALGORITMO, chave, iv);
  decipher.setAuthTag(tag);
  const claro = Buffer.concat([
    decipher.update(dados),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(claro);
}
