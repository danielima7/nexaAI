/**
 * Gera um convite de acesso ao Chat Web e imprime o link para enviar ao cliente.
 *
 * Empresa nova (cria a organizacao quando o cliente aceitar):
 *   npm run chat:convite -- --email dono@empresa.com --empresa "Padaria do Ze"
 *
 * Adicionar alguem a uma organizacao existente (multiusuario):
 *   npm run chat:convite -- --email socio@empresa.com --org <uuid>
 *
 * O token so aparece nesta saida — ele nao fica em claro no banco. Se perder
 * o link, gere outro convite.
 */
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ChatAccountService } from '../chat/chat-account.service';
import { InviteService } from '../chat/invite.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const config = new ConfigService();
  const contas = new ChatAccountService(prisma as any);
  const convites = new InviteService(prisma as any, config, contas);

  try {
    // Sem --email o convite nasce ABERTO: quem receber o link informa o
    // proprio endereco. Comodo para mandar por WhatsApp sem saber qual e-mail
    // a pessoa usa — em troca, vale para qualquer um que receba o link.
    const email = arg('email');
    const aberto = arg('aberto') !== undefined || process.argv.includes('--aberto');

    if (!email && !aberto) {
      // A ajuda mostra as duas formas porque o comando muda conforme onde roda:
      // no servidor nao existe ts-node (a imagem e --omit=dev), entao o script
      // de desenvolvimento falharia justamente na hora de atender um cliente.
      console.error(
        'ERRO: informe --email OU --aberto.\n\n' +
          '  Convite DIRECIONADO (o e-mail ja vem travado na tela):\n' +
          '    --email dono@empresa.com --empresa "Nome da Empresa"\n\n' +
          '  Convite ABERTO (quem receber o link digita o proprio e-mail):\n' +
          '    --aberto --empresa "Nome da Empresa"\n\n' +
          '  Para adicionar alguem a uma empresa existente, troque --empresa por --org <uuid>.\n\n' +
          '  No seu computador (desenvolvimento):\n' +
          '    npm run chat:convite -- --aberto --empresa "Nome"\n\n' +
          '  No servidor (producao):\n' +
          '    docker compose -f docker-compose.prod.yml exec app \\\n' +
          '      npm run prod:convite -- --aberto --empresa "Nome"',
      );
      process.exit(1);
    }

    const organizationId = arg('org');
    const companyName = arg('empresa');

    if (!organizationId && !companyName) {
      console.error(
        'ERRO: informe --empresa (para criar uma organizacao nova) ou --org <uuid> (para uma existente).',
      );
      process.exit(1);
    }

    if (organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!org) {
        console.error(`ERRO: organizacao ${organizationId} nao existe.`);
        process.exit(1);
      }
      console.log(`Convite para a organizacao existente "${org.name}".`);
    }

    const { link, expiresAt } = await convites.criar({
      email,
      companyName,
      organizationId,
    });

    console.log('\n✅ Convite criado\n');
    console.log(
      email
        ? `   para:   ${email}`
        : '   tipo:   ABERTO — quem abrir o link informa o proprio e-mail',
    );
    console.log(`   validade: ${expiresAt.toLocaleString('pt-BR')}`);
    console.log(`\n   ${link}\n`);
    console.log('   Envie este link ao cliente. Ele escolhe a propria senha e');
    console.log('   ja entra no chat. O link vale uma unica vez.');
  } catch (e: any) {
    console.error(`\nERRO: ${e?.message ?? e}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Falha ao criar o convite:', e);
  process.exit(1);
});
