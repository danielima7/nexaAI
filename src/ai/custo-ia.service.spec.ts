import { ConfigService } from '@nestjs/config';
import { CustoIaService } from './custo-ia.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Calculo de custo de IA.
 *
 * Erro aqui e silencioso e caro nos dois sentidos: subestimar faz o alerta
 * nunca disparar (o prejuizo aparece na fatura); superestimar faz disparar
 * toda hora, e alerta que grita sempre e alerta que ninguem le.
 *
 * O caso mais importante e o do cache: ele representa a maior parte dos
 * tokens de entrada em conversas reais, e cobrar cache-read a preco cheio
 * inflaria a conta em varias vezes.
 */
describe('CustoIaService', () => {
  type Registro = {
    modelo: string;
    organizationId: string | null;
    rodada: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };

  const montar = (registros: Registro[], cotacao = '5.00') => {
    const prisma = {
      aiUsage: { findMany: jest.fn().mockResolvedValue(registros) },
    } as unknown as PrismaService;
    const config = {
      get: (k: string) => (k === 'KATALLI_COTACAO_USD' ? cotacao : undefined),
    } as unknown as ConfigService;
    return new CustoIaService(prisma, config);
  };

  const registro = (over: Partial<Registro> = {}): Registro => ({
    modelo: 'claude-sonnet-5',
    organizationId: 'org-1',
    rodada: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...over,
  });

  describe('precos por modelo', () => {
    it('cobra Sonnet 5 a 3/15 por milhao', async () => {
      const s = montar([
        registro({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      ]);
      const r = await s.relatorioDeHoje();
      expect(r.usd).toBeCloseTo(18, 4); // 3 (entrada) + 15 (saida)
    });

    it('cobra Haiku 4.5 a 1/5 por milhao', async () => {
      const s = montar([
        registro({
          modelo: 'claude-haiku-4-5',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
      ]);
      expect((await s.relatorioDeHoje()).usd).toBeCloseTo(6, 4);
    });

    it('cobra Opus a 5/25 por milhao', async () => {
      const s = montar([
        registro({
          modelo: 'claude-opus-4-8',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
      ]);
      expect((await s.relatorioDeHoje()).usd).toBeCloseTo(30, 4);
    });

    it('modelo desconhecido assume o MAIS CARO, para nao subestimar', async () => {
      const s = montar([
        registro({
          modelo: 'modelo-que-ainda-nao-existe',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
      ]);
      expect((await s.relatorioDeHoje()).usd).toBeCloseTo(30, 4);
    });
  });

  describe('cache', () => {
    it('cobra leitura de cache a 10% da entrada', async () => {
      const s = montar([registro({ cacheReadTokens: 1_000_000 })]);
      // 1M x $3 x 0,1
      expect((await s.relatorioDeHoje()).usd).toBeCloseTo(0.3, 4);
    });

    it('cobra escrita de cache a 125% da entrada', async () => {
      const s = montar([registro({ cacheWriteTokens: 1_000_000 })]);
      // 1M x $3 x 1,25
      expect((await s.relatorioDeHoje()).usd).toBeCloseTo(3.75, 4);
    });

    it('nao cobra cache lido como se fosse entrada cheia', async () => {
      const comCache = montar([registro({ cacheReadTokens: 1_000_000 })]);
      const semCache = montar([registro({ inputTokens: 1_000_000 })]);
      const a = (await comCache.relatorioDeHoje()).usd;
      const b = (await semCache.relatorioDeHoje()).usd;
      expect(a).toBeLessThan(b);
      expect(a).toBeCloseTo(b * 0.1, 4);
    });
  });

  describe('contagem de interacoes', () => {
    it('conta apenas a rodada 0 — as demais sao o loop de tool use', async () => {
      const s = montar([
        registro({ rodada: 0 }),
        registro({ rodada: 1 }),
        registro({ rodada: 2 }),
        registro({ rodada: 0 }),
      ]);
      expect((await s.relatorioDeHoje()).interacoes).toBe(2);
    });

    it('mas o custo soma TODAS as rodadas', async () => {
      const s = montar([
        registro({ rodada: 0, inputTokens: 1_000_000 }),
        registro({ rodada: 1, inputTokens: 1_000_000 }),
      ]);
      const r = await s.relatorioDeHoje();
      expect(r.interacoes).toBe(1);
      expect(r.usd).toBeCloseTo(6, 4); // as duas rodadas custam
    });
  });

  describe('conversao para real', () => {
    it('usa a cotacao configurada', async () => {
      const s = montar([registro({ inputTokens: 1_000_000 })], '5.00');
      expect((await s.relatorioDeHoje()).brl).toBeCloseTo(15, 2); // 3 x 5
    });

    it.each([
      ['ausente', undefined],
      ['vazia', ''],
      ['zero', '0'],
      ['texto', 'abc'],
      ['negativa', '-2'],
    ])('cai no padrao quando a cotacao e %s', (_c, valor) => {
      // Construido direto, sem o helper: o valor padrao do parametro
      // esconderia justamente o caso "variavel ausente".
      const s = new CustoIaService(
        { aiUsage: { findMany: jest.fn() } } as unknown as PrismaService,
        { get: () => valor } as unknown as ConfigService,
      );
      expect(s.cotacao).toBe(5.4);
    });
  });

  describe('quebra por modelo e por empresa', () => {
    it('agrupa e ordena do mais caro para o mais barato', async () => {
      const s = montar([
        registro({ modelo: 'claude-haiku-4-5', organizationId: 'org-a', inputTokens: 1_000_000 }),
        registro({ modelo: 'claude-opus-4-8', organizationId: 'org-b', inputTokens: 1_000_000 }),
      ]);
      const r = await s.relatorioDeHoje();
      expect(r.porModelo[0].modelo).toBe('claude-opus-4-8');
      expect(r.porOrganizacao[0].organizationId).toBe('org-b');
    });

    it('nao perde o consumo sem organizacao', async () => {
      const s = montar([registro({ organizationId: null, inputTokens: 1_000_000 })]);
      const r = await s.relatorioDeHoje();
      expect(r.porOrganizacao[0].organizationId).toBeNull();
      expect(r.usd).toBeGreaterThan(0);
    });
  });

  it('periodo vazio devolve zero, nao quebra', async () => {
    const r = await montar([]).relatorioDeHoje();
    expect(r).toMatchObject({ usd: 0, brl: 0, interacoes: 0, porModelo: [], porOrganizacao: [] });
  });
});
