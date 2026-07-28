/**
 * Migra as credenciais das integracoes (Connection.credentials) de texto plano
 * para AES-256-GCM.
 *
 * Uso:  npm run credenciais:cifrar
 *
 * E idempotente: registros ja cifrados sao ignorados, entao rodar duas vezes
 * nao causa dano. Deliberadamente NAO roda no boot da aplicacao — reescrever
 * credenciais automaticamente na subida e o caminho curto para perder acesso a
 * tudo caso a chave esteja errada.
 *
 * ATENCAO: guarde `CONNECTION_ENCRYPTION_KEY` em local seguro. Sem ela, os
 * dados cifrados sao irrecuperaveis — nao ha como "resetar" a chave depois.
 */
import { PrismaClient } from '@prisma/client';
import { carregarChave, cifrar, estaCifrado } from '../connections/credentials-crypto';

// Carrega o .env (dotenv vem junto com @nestjs/config).
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

async function main(): Promise<void> {
  const chave = carregarChave(process.env.CONNECTION_ENCRYPTION_KEY);
  if (!chave) {
    console.error(
      'ERRO: CONNECTION_ENCRYPTION_KEY ausente ou invalida (esperado: 64 caracteres hex).\n' +
        'Gere uma com:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const conexoes = await prisma.connection.findMany();
    console.log(`Conexoes encontradas: ${conexoes.length}`);

    let cifradas = 0;
    let jaCifradas = 0;

    for (const conexao of conexoes) {
      if (estaCifrado(conexao.credentials)) {
        jaCifradas++;
        console.log(`  - ${conexao.provider}: ja cifrada, ignorando.`);
        continue;
      }

      const claro = (conexao.credentials ?? {}) as Record<string, any>;
      await prisma.connection.update({
        where: { id: conexao.id },
        data: { credentials: cifrar(claro, chave) },
      });
      cifradas++;
      console.log(`  - ${conexao.provider}: cifrada.`);
    }

    console.log(
      `\nConcluido. Cifradas agora: ${cifradas}. Ja estavam cifradas: ${jaCifradas}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Falha na migracao:', e);
  process.exit(1);
});
