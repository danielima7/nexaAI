import { ConfigService } from '@nestjs/config';
import { ProspeccaoService } from './prospeccao.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { GoogleService } from '../integrations/google/google.service';

/**
 * As travas aqui existem porque prospeccao sem memoria vira dano: contato
 * repetido, gente que pediu para sair recebendo de novo, e volume que queima
 * o dominio — e junto com ele o resumo diario e os alertas, que saem pelo
 * mesmo endereco.
 */
describe('ProspeccaoService', () => {
  function montar(opcoes: {
    existente?: unknown;
    enviadosHoje?: number;
    teto?: string;
    sendFalha?: Error;
    semGoogle?: boolean;
  }) {
    const criados: unknown[] = [];
    const enviados: { to: string; corpo: string }[] = [];

    const prisma = {
      prospecto: {
        findUnique: jest.fn().mockResolvedValue(opcoes.existente ?? null),
        count: jest.fn().mockResolvedValue(opcoes.enviadosHoje ?? 0),
        create: jest.fn(async ({ data }: { data: unknown }) => {
          criados.push(data);
          return data;
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;

    const config = {
      get: () => opcoes.teto,
    } as unknown as ConfigService;

    const connections = {
      resolveToken: jest.fn().mockResolvedValue(opcoes.semGoogle ? undefined : 'tk'),
    } as unknown as ConnectionsService;

    const google = {
      sendEmail: jest.fn(async (_t: string, to: string, _s: string, corpo: string) => {
        if (opcoes.sendFalha) throw opcoes.sendFalha;
        enviados.push({ to, corpo });
      }),
    } as unknown as GoogleService;

    return {
      servico: new ProspeccaoService(prisma, config, connections, google),
      criados,
      enviados,
      google,
    };
  }

  const dados = {
    email: 'Contato@Empresa.COM',
    assunto: 'Oi',
    corpo: 'Texto da abordagem.',
  };

  it('envia e registra o contato', async () => {
    const { servico, criados, enviados } = montar({});
    const r = await servico.enviar('org-1', dados);

    expect(r.enviado).toBe(true);
    // Normalizado: "Contato@Empresa.COM" e "contato@empresa.com" sao a mesma
    // pessoa, e sem isso ela receberia duas vezes.
    expect(enviados[0].to).toBe('contato@empresa.com');
    expect((criados[0] as { email: string }).email).toBe('contato@empresa.com');
  });

  it('recusa quem ja foi contatado', async () => {
    const { servico, google } = montar({
      existente: { status: 'contatado', contatadoEm: new Date('2026-08-20') },
    });
    const r = await servico.enviar('org-1', dados);

    expect(r.enviado).toBe(false);
    expect(r.motivo).toContain('ja foi contatado');
    expect(google.sendEmail).not.toHaveBeenCalled();
  });

  it('recusa quem pediu para sair, com prioridade sobre qualquer outra regra', async () => {
    const { servico, google } = montar({
      existente: { status: 'descadastrado', contatadoEm: new Date() },
    });
    const r = await servico.enviar('org-1', dados);

    expect(r.motivo).toContain('pediu para nao receber');
    expect(google.sendEmail).not.toHaveBeenCalled();
  });

  it('respeita o teto diario', async () => {
    const { servico, google } = montar({ enviadosHoje: 20 });
    const r = await servico.enviar('org-1', dados);

    expect(r.enviado).toBe(false);
    expect(r.motivo).toContain('20');
    expect(google.sendEmail).not.toHaveBeenCalled();
  });

  it('o teto e configuravel', async () => {
    const { servico } = montar({ enviadosHoje: 20, teto: '50' });
    await expect(servico.enviar('org-1', dados)).resolves.toMatchObject({
      enviado: true,
    });
  });

  it('recusa endereco invalido antes de qualquer consulta', async () => {
    const { servico, google } = montar({});
    const r = await servico.enviar('org-1', { ...dados, email: 'nao-e-email' });

    expect(r.enviado).toBe(false);
    expect(google.sendEmail).not.toHaveBeenCalled();
  });

  it('NAO registra o contato quando o envio falha', async () => {
    // Registrar antes marcaria como abordado alguem que nao recebeu nada — e
    // essa pessoa nunca mais seria contatada.
    const { servico, criados } = montar({ sendFalha: new Error('smtp caiu') });
    const r = await servico.enviar('org-1', dados);

    expect(r.enviado).toBe(false);
    expect(criados).toHaveLength(0);
  });

  it('traduz autorizacao vencida do Google em acao clara', async () => {
    const { servico } = montar({ sendFalha: new Error('invalid_grant') });
    expect((await servico.enviar('org-1', dados)).motivo).toContain('Reconecte');
  });

  it('avisa quando o Google nem esta conectado', async () => {
    const { servico } = montar({ semGoogle: true });
    expect((await servico.enviar('org-1', dados)).motivo).toContain('nao esta conectado');
  });
});

describe('ProspeccaoService.comSaidaFacil', () => {
  it('acrescenta a forma de sair quando falta', () => {
    // No service e nao no prompt: e obrigacao de quem manda mensagem comercial
    // nao solicitada, e deixar a IA lembrar garante que um dia ela esqueca.
    const r = ProspeccaoService.comSaidaFacil('Ola, tudo bem?');
    expect(r.toLowerCase()).toContain('sair');
  });

  it('nao duplica quando o texto ja oferece saida', () => {
    const corpo = 'Ola. Se nao quiser mais, responda com "sair".';
    expect(ProspeccaoService.comSaidaFacil(corpo)).toBe(corpo);
  });
});

describe('ProspeccaoService.normalizar', () => {
  it('tira espaco e caixa', () => {
    expect(ProspeccaoService.normalizar('  Joao@X.COM ')).toBe('joao@x.com');
  });
});
