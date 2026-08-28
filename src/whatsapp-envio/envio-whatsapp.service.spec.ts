import { ConsentimentoService } from './consentimento.service';
import { TemplateService } from './template.service';
import { EnvioWhatsappService } from './envio-whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service';

/**
 * Cada teste aqui corresponde a uma regra da politica do WhatsApp cuja punicao
 * documentada e o encerramento da conta. Nao sao testes de conveniencia: se um
 * deles deixar de existir, o produto volta a poder queimar o numero do cliente
 * sem que nada no build reclame.
 */
describe('EnvioWhatsappService', () => {
  const ORG = 'org-1';
  const HORA = 3600_000;

  function montar(opcoes: {
    consentimento?: Record<string, unknown> | null;
    template?: Record<string, unknown> | null;
    falhaEnvio?: Error;
  }) {
    const enviados: { to: string; corpo: string }[] = [];

    const prisma = {
      consentimentoWhatsapp: {
        findUnique: jest.fn().mockResolvedValue(opcoes.consentimento ?? null),
        upsert: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      templateWhatsapp: {
        findUnique: jest.fn().mockResolvedValue(opcoes.template ?? null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;

    const whatsapp = {
      sendTextMessage: jest.fn(async (to: string, corpo: string) => {
        if (opcoes.falhaEnvio) throw opcoes.falhaEnvio;
        enviados.push({ to, corpo });
      }),
    } as unknown as WhatsappService;

    return {
      servico: new EnvioWhatsappService(
        new ConsentimentoService(prisma),
        new TemplateService(prisma),
        whatsapp,
      ),
      enviados,
    };
  }

  const ativo = {
    telefone: '24999998888',
    status: 'ativo',
    ultimaEntradaEm: null as Date | null,
  };

  const aprovado = {
    nome: 'lembrete',
    status: 'aprovado',
    corpo: 'Ola {{1}}, seu boleto vence em {{2}}.',
    variaveis: 2,
  };

  describe('template', () => {
    it('recusa quando nao ha consentimento registrado', async () => {
      const { servico, enviados } = montar({ consentimento: null });

      const r = await servico.enviarTemplate(ORG, {
        telefone: '24999998888',
        template: 'lembrete',
        valores: ['Ana', '10/09'],
      });

      expect(r.enviado).toBe(false);
      expect(r.motivo).toContain('autorização');
      expect(enviados).toHaveLength(0);
    });

    it('recusa quem revogou, mesmo com template aprovado', async () => {
      const { servico, enviados } = montar({
        consentimento: { ...ativo, status: 'revogado' },
        template: aprovado,
      });

      const r = await servico.enviarTemplate(ORG, {
        telefone: '24999998888',
        template: 'lembrete',
        valores: ['Ana', '10/09'],
      });

      expect(r.enviado).toBe(false);
      expect(enviados).toHaveLength(0);
    });

    it('recusa template ainda nao aprovado pela Meta', async () => {
      const { servico, enviados } = montar({
        consentimento: ativo,
        template: { ...aprovado, status: 'rascunho' },
      });

      const r = await servico.enviarTemplate(ORG, {
        telefone: '24999998888',
        template: 'lembrete',
        valores: ['Ana', '10/09'],
      });

      expect(r.enviado).toBe(false);
      expect(r.motivo).toContain('aprovado');
      expect(enviados).toHaveLength(0);
    });

    it('recusa quando a quantidade de variaveis nao bate', async () => {
      const { servico, enviados } = montar({
        consentimento: ativo,
        template: aprovado,
      });

      const r = await servico.enviarTemplate(ORG, {
        telefone: '24999998888',
        template: 'lembrete',
        valores: ['Ana'],
      });

      expect(r.enviado).toBe(false);
      expect(enviados).toHaveLength(0);
    });

    // Fora da janela o template E o caminho valido — a trava nao pode virar
    // bloqueio geral, senao o recurso nao serve para nada.
    it('envia com consentimento ativo e template aprovado', async () => {
      const { servico, enviados } = montar({
        consentimento: ativo,
        template: aprovado,
      });

      const r = await servico.enviarTemplate(ORG, {
        telefone: '(24) 99999-8888',
        template: 'lembrete',
        valores: ['Ana', '10/09'],
      });

      expect(r.enviado).toBe(true);
      expect(enviados).toEqual([
        { to: '24999998888', corpo: 'Ola Ana, seu boleto vence em 10/09.' },
      ]);
    });
  });

  describe('texto livre', () => {
    it('recusa fora da janela de 24h', async () => {
      const { servico, enviados } = montar({
        consentimento: {
          ...ativo,
          ultimaEntradaEm: new Date(Date.now() - 25 * HORA),
        },
      });

      const r = await servico.responder(ORG, '24999998888', 'oi');

      expect(r.enviado).toBe(false);
      expect(r.motivo).toContain('24 horas');
      expect(enviados).toHaveLength(0);
    });

    it('envia dentro da janela de 24h', async () => {
      const { servico, enviados } = montar({
        consentimento: {
          ...ativo,
          ultimaEntradaEm: new Date(Date.now() - 2 * HORA),
        },
      });

      const r = await servico.responder(ORG, '24999998888', 'oi, tudo bem?');

      expect(r.enviado).toBe(true);
      expect(enviados).toHaveLength(1);
    });

    // Quem pediu para sair de divulgacao e volta a escrever esta pedindo
    // atendimento. Nao responder seria pior servico, e a politica nao exige.
    it('responde quem revogou mas voltou a escrever', async () => {
      const { servico, enviados } = montar({
        consentimento: {
          ...ativo,
          status: 'revogado',
          ultimaEntradaEm: new Date(Date.now() - 1 * HORA),
        },
      });

      const r = await servico.responder(ORG, '24999998888', 'pode me ajudar?');

      expect(r.enviado).toBe(true);
      expect(enviados).toHaveLength(1);
    });
  });

  it('traduz numero banido em explicacao acionavel', async () => {
    const { servico } = montar({
      consentimento: ativo,
      template: aprovado,
      falhaEnvio: new Error('(#131031) Account has been banned'),
    });

    const r = await servico.enviarTemplate(ORG, {
      telefone: '24999998888',
      template: 'lembrete',
      valores: ['Ana', '10/09'],
    });

    expect(r.enviado).toBe(false);
    expect(r.motivo).toContain('banido');
  });
});
