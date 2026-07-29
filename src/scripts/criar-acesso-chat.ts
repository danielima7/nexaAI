/**
 * Cria (ou reseta) um acesso ao Chat Web para uma organizacao.
 *
 * Uso:
 *   npm run chat:acesso -- --org <uuid> --email dono@empresa.com [--senha ...] [--nome "Fulano"]
 *
 * Sem `--org`, apenas lista as organizacoes existentes e sai — util para
 * descobrir o id sem abrir o psql.
 * Sem `--senha`, gera uma senha forte e a imprime uma unica vez.
 *
 * Rodar o mesmo comando para um e-mail que ja existe apenas troca a senha,
 * entao este script tambem e o "esqueci minha senha" enquanto nao existe tela.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { ChatAccountService } from '../chat/chat-account.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

/** Le --chave valor da linha de comando. */
function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Senha legivel, sem caracteres ambiguos. */
function senhaAleatoria(): string {
  return randomBytes(12)
    .toString('base64')
    .replace(/[+/=lIO01]/g, '')
    .slice(0, 14);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const contas = new ChatAccountService(prisma as any);

  try {
    const organizationId = arg('org');

    if (!organizationId) {
      const orgs = await prisma.organization.findMany({
        orderBy: { createdAt: 'asc' },
      });
      console.log('Organizacoes disponiveis:\n');
      for (const o of orgs) console.log(`  ${o.id}  ${o.name}`);
      console.log(
        '\nRode de novo com:  npm run chat:acesso -- --org <id> --email <e-mail>',
      );
      return;
    }

    const email = arg('email');
    if (!email) {
      console.error('ERRO: informe --email.');
      process.exit(1);
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      console.error(`ERRO: organizacao ${organizationId} nao existe.`);
      process.exit(1);
    }

    const senha = arg('senha') ?? senhaAleatoria();
    const geramos = !arg('senha');

    const user = await contas.definirAcesso({
      organizationId,
      email,
      senha,
      nome: arg('nome'),
    });

    console.log(`\n✅ Acesso pronto para "${org.name}"`);
    console.log(`   e-mail: ${user.email}`);
    if (geramos) {
      console.log(`   senha:  ${senha}`);
      console.log('\n   Esta senha nao sera exibida de novo — guarde agora.');
    } else {
      console.log('   senha:  (a que voce informou)');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Falha ao criar o acesso:', e);
  process.exit(1);
});
