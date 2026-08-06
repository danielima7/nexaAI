/**
 * Backup do banco do Katalli.
 *
 * Uso:
 *   npm run banco:backup
 *   npm run banco:backup -- --dir /caminho/dos/backups --reter 30
 *
 * Roda `pg_dump` dentro do container do Postgres, entao nao exige o cliente
 * instalado na maquina — funciona igual no Windows e numa VPS Linux.
 *
 * ⚠️ O dump contem `Connection.credentials` CIFRADO. Ele so tem valor junto com
 * a `CONNECTION_ENCRYPTION_KEY` — guarde a chave em OUTRO lugar, nunca na
 * mesma pasta ou no mesmo balde do backup. Backup e chave juntos equivalem a
 * guardar o cofre com a senha colada na porta.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Nome de arquivo ordenavel e sem caractere invalido no Windows. */
function carimbo(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function main(): void {
  const container = process.env.POSTGRES_CONTAINER ?? 'nexa-postgres';
  const usuario = process.env.POSTGRES_USER ?? 'nexa';
  const banco = process.env.POSTGRES_DB ?? 'nexa';
  const destino = arg('dir') ?? 'backups';
  const reterDias = Number(arg('reter') ?? 14);

  if (!existsSync(destino)) mkdirSync(destino, { recursive: true });

  const arquivo = join(destino, `katalli-${carimbo()}.sql`);

  console.log(`Gerando backup de "${banco}" (container ${container})...`);
  let dump: Buffer;
  try {
    dump = execFileSync(
      'docker',
      ['exec', container, 'pg_dump', '-U', usuario, '-d', banco],
      { maxBuffer: 512 * 1024 * 1024 },
    );
  } catch (e: any) {
    console.error(
      `\nERRO ao executar o pg_dump: ${e?.message ?? e}\n\n` +
        `Confira se o container "${container}" esta rodando (docker ps) ou\n` +
        'defina POSTGRES_CONTAINER no .env com o nome correto.',
    );
    process.exit(1);
  }

  writeFileSync(arquivo, dump);
  const mb = (dump.length / 1024 / 1024).toFixed(2);
  console.log(`✅ Backup salvo: ${arquivo} (${mb} MB)`);

  // Retencao: remove dumps mais antigos que a janela configurada.
  const limite = Date.now() - reterDias * 24 * 60 * 60 * 1000;
  let removidos = 0;
  for (const nome of readdirSync(destino)) {
    if (!nome.startsWith('katalli-') || !nome.endsWith('.sql')) continue;
    const caminho = join(destino, nome);
    if (statSync(caminho).mtimeMs < limite) {
      unlinkSync(caminho);
      removidos++;
    }
  }
  if (removidos > 0) {
    console.log(`   ${removidos} backup(s) com mais de ${reterDias} dias removido(s).`);
  }

  console.log(
    '\n⚠️  Este arquivo contem as credenciais dos clientes (cifradas).\n' +
      '   Guarde a CONNECTION_ENCRYPTION_KEY em local separado do backup.',
  );
}

main();
