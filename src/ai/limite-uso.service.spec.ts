import { LimiteUsoService, OrganizacaoParaLimite } from './limite-uso.service';
import { AiUsageService } from './ai-usage.service';
import { PLANOS, PLANO_PADRAO } from './planos';

/**
 * Testes do limite de uso.
 *
 * O que precisa ficar travado aqui e o comportamento COM DINHEIRO ENVOLVIDO:
 * plano desconhecido nao pode virar ilimitado, e o override do cliente tem que
 * valer inclusive quando aperta mais que o plano. Um erro nesses dois pontos so
 * apareceria na fatura da Anthropic no fim do mes.
 */
describe('LimiteUsoService', () => {
  const cotaPadrao = PLANOS[PLANO_PADRAO].tokensDia!;

  function montar(tokensHoje: number, interacoes = 0) {
    const uso = {
      tokensDoDia: jest.fn().mockResolvedValue(tokensHoje),
      contarInteracoes: jest.fn().mockResolvedValue(interacoes),
    } as unknown as AiUsageService;
    return { servico: new LimiteUsoService(uso), uso };
  }

  const org = (extra: Partial<OrganizacaoParaLimite> = {}): OrganizacaoParaLimite => ({
    id: 'org-1',
    plano: PLANO_PADRAO,
    limiteTokensDia: null,
    limiteInteracoes: null,
    ...extra,
  });

  it('libera quem esta abaixo da cota do plano', async () => {
    const { servico } = montar(cotaPadrao - 1);
    await expect(servico.verificar(org())).resolves.toEqual({ permitido: true });
  });

  it('bloqueia ao atingir a cota, nao apenas ao ultrapassar', async () => {
    // Exatamente no teto ja bloqueia: a mensagem seguinte gastaria alem dele.
    const { servico } = montar(cotaPadrao);
    const veredito = await servico.verificar(org());

    expect(veredito.permitido).toBe(false);
    expect(veredito.motivo).toContain('limite de uso de hoje');
    // O texto precisa dizer que renova — senao o cliente acha que travou a conta.
    expect(veredito.motivo).toContain('renova');
  });

  it('usa o override da organizacao no lugar da cota do plano', async () => {
    const { servico } = montar(2_000);
    // Override menor que o plano: o cliente ja estourou.
    const apertado = await servico.verificar(org({ limiteTokensDia: 1_000 }));
    expect(apertado.permitido).toBe(false);

    // Override maior: continua liberado onde o plano ja teria bloqueado.
    const { servico: outro } = montar(cotaPadrao + 1);
    const folgado = await outro.verificar(
      org({ limiteTokensDia: cotaPadrao * 10 }),
    );
    expect(folgado.permitido).toBe(true);
  });

  it('override zero bloqueia (nao e tratado como "sem limite")', async () => {
    // Zero e falsy em JS: uma checagem descuidada liberaria consumo infinito
    // justamente para a organizacao que devia estar suspensa.
    const { servico } = montar(0);
    await expect(
      servico.verificar(org({ limiteTokensDia: 0 })),
    ).resolves.toMatchObject({ permitido: false });
  });

  it('plano desconhecido cai no padrao, nunca em ilimitado', async () => {
    const { servico } = montar(cotaPadrao);
    const veredito = await servico.verificar(org({ plano: 'plano-que-nao-existe' }));
    expect(veredito.permitido).toBe(false);
  });

  it('trial esgotado bloqueia antes de olhar a cota diaria', async () => {
    // Consumo zerado hoje: se a ordem estivesse invertida, passaria.
    const { servico, uso } = montar(0, 30);
    const veredito = await servico.verificar(org({ limiteInteracoes: 30 }));

    expect(veredito.permitido).toBe(false);
    expect(veredito.motivo).toContain('conta gratuita');
    expect(uso.tokensDoDia).not.toHaveBeenCalled();
  });

  it('organizacao sem trial nao consulta a contagem de interacoes', async () => {
    const { servico, uso } = montar(0);
    await servico.verificar(org());
    expect(uso.contarInteracoes).not.toHaveBeenCalled();
  });

  it('situacao reporta o restante sem nunca ficar negativo', async () => {
    const { servico } = montar(cotaPadrao * 2);
    const s = await servico.situacao(org());

    expect(s.restante).toBe(0);
    expect(s.percentual).toBe(200);
  });
});

describe('AiUsageService.inicioDoDiaBrasil', () => {
  it('devolve um instante no passado, dentro das ultimas 24h', () => {
    const inicio = AiUsageService.inicioDoDiaBrasil();
    const decorrido = Date.now() - inicio.getTime();

    expect(decorrido).toBeGreaterThanOrEqual(0);
    expect(decorrido).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('cai numa virada de hora cheia em Sao Paulo (meia-noite local)', () => {
    const inicio = AiUsageService.inicioDoDiaBrasil();
    const hora = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(inicio);

    expect(hora).toBe('00:00');
  });
});
