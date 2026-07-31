/**
 * Cria (ou recria) a organizacao de DEMONSTRACAO.
 *
 * Uso:
 *   npm run demo:criar
 *   npm run demo:criar -- --email demo@kyrius.com.br --senha MinhaSenha
 *
 * Serve para apresentar o produto numa reuniao sem expor dados reais — seus ou
 * de clientes. As ferramentas respondem com dados ficticios de uma auto
 * eletrica, mas todo o resto e o produto de verdade: a IA escolhe a ferramenta,
 * a execucao e auditada e acoes de escrita pedem confirmacao.
 *
 * Rodar de novo apenas atualiza a senha e as conexoes — nao duplica nada.
 */
import { PrismaClient } from '@prisma/client';
import { ChatAccountService } from '../chat/chat-account.service';
import { EMPRESA_DEMO } from '../demo/demo-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Integracoes que a demonstracao aparenta ter conectadas.
 *
 * As credenciais sao propositalmente invalidas: em organizacao `demo` o
 * ToolRegistry devolve dados ficticios ANTES de tocar na API, entao o token
 * nunca e usado. Elas existem so para a tela de integracoes e as perguntas
 * sugeridas refletirem uma empresa completa.
 */
const INTEGRACOES_DEMO = [
  'asaas',
  'stripe',
  'mercadopago',
  'hubspot',
  'google',
  'instagram',
  'pluggy',
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const contas = new ChatAccountService(prisma as any);

  try {
    const email = arg('email') ?? 'demo@kyrius.com.br';
    const senha = arg('senha') ?? 'demo-kyrius-2026';

    // Organizacao (idempotente pelo nome).
    let org = await prisma.organization.findFirst({
      where: { name: EMPRESA_DEMO },
    });

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: EMPRESA_DEMO,
          demo: true,
          atendimentoInstrucoes:
            'Somos uma auto eletrica. Atendemos de segunda a sexta das 8h as 18h e sabado ate as 12h. ' +
            'Fazemos instalacao de som e alarme, diagnostico eletrico, troca de alternador e bateria. ' +
            'Orcamento e feito presencialmente, sem custo.',
        },
      });
      console.log(`Organizacao criada: ${org.name}`);
    } else {
      org = await prisma.organization.update({
        where: { id: org.id },
        data: { demo: true },
      });
      console.log(`Organizacao ja existia: ${org.name}`);
    }

    // Acesso ao chat.
    await contas.definirAcesso({
      organizationId: org.id,
      email,
      senha,
      nome: 'Demonstracao',
    });

    // Conexoes aparentes.
    for (const provider of INTEGRACOES_DEMO) {
      await prisma.connection.upsert({
        where: {
          organizationId_provider: { organizationId: org.id, provider },
        },
        create: {
          organizationId: org.id,
          provider,
          credentials: { v: 1, enc: 'demo' },
        },
        update: {},
      });
    }

    console.log(`\n✅ Demonstracao pronta\n`);
    console.log(`   empresa:  ${org.name}`);
    console.log(`   e-mail:   ${email}`);
    console.log(`   senha:    ${senha}`);
    console.log(`   conectadas: ${INTEGRACOES_DEMO.length} integracoes (ficticias)`);
    console.log(`\n   Entre em /chat com essas credenciais e pergunte, por exemplo:`);
    console.log(`     "Quem esta inadimplente?"`);
    console.log(`     "Qual meu saldo bancario?"`);
    console.log(`     "Como foi meu Instagram essa semana?"`);
    console.log(
      `\n   ⚠️  Nao use esta conta para dados reais: as ferramentas nunca chamam as APIs.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Falha ao criar a demonstracao:', e);
  process.exit(1);
});
