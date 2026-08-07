/**
 * Quanto a IA custou — hoje, na semana e no mes.
 *
 *   npm run custo              (padrao: hoje)
 *   npm run custo -- --dias 7
 *   npm run custo -- --dias 30
 *
 * Le a tabela AiUsage, que registra cada chamada a API. Nao consulta a
 * Anthropic: o numero e o nosso, calculado dos tokens que gravamos.
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { CustoIaService } from '../ai/custo-ia.service';
import { PrismaService } from '../prisma/prisma.service';

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const real = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const custos = new CustoIaService(
    prisma as unknown as PrismaService,
    new ConfigService(),
  );

  try {
    const dias = Number(arg('dias') ?? 0);
    const desde =
      dias > 0
        ? new Date(Date.now() - dias * 86_400_000)
        : CustoIaService.inicioDoDia();

    const r = await custos.relatorio(desde);
    const periodo = dias > 0 ? `ultimos ${dias} dias` : 'hoje';

    console.log(`\nCUSTO DE IA — ${periodo}\n`);
    console.log(`  Total: ${real(r.brl)}  (US$ ${r.usd.toFixed(2)})`);
    console.log(`  Interacoes: ${r.interacoes}`);
    if (r.interacoes > 0) {
      console.log(`  Media por interacao: ${real(r.brl / r.interacoes)}`);
    }
    console.log(`  Cotacao usada: US$ 1,00 = ${real(custos.cotacao)}`);

    if (r.porModelo.length) {
      console.log('\n  POR MODELO');
      for (const m of r.porModelo) {
        console.log(
          `    ${m.modelo.padEnd(20)} ${real(m.brl).padStart(12)}  ${String(m.interacoes).padStart(5)} interacoes`,
        );
      }
    }

    if (r.porOrganizacao.length) {
      console.log('\n  POR EMPRESA');
      for (const o of r.porOrganizacao) {
        let nome = 'sem organizacao';
        let marca = '';
        if (o.organizationId) {
          const org = await prisma.organization.findUnique({
            where: { id: o.organizationId },
          });
          nome = org?.name ?? o.organizationId;
          if (org?.autocadastro) marca = '  [autocadastro]';
          if (org?.demo) marca = '  [demo]';
        }
        console.log(
          `    ${nome.slice(0, 30).padEnd(30)} ${real(o.brl).padStart(12)}  ${String(o.interacoes).padStart(5)} interacoes${marca}`,
        );
      }
    }

    if (!r.interacoes) {
      console.log('\n  (nenhum uso registrado no periodo)');
    }
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
