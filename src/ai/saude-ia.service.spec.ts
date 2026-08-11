import { SaudeIaService } from './saude-ia.service';

/**
 * O erro real de saldo zerado, como o SDK entrega: status 400 e a distincao
 * inteira dentro do texto. Copiado do log de producao de 11/08/2026 — se um
 * dia a Anthropic mudar a frase, e este teste que vai avisar.
 */
const ERRO_SALDO = Object.assign(
  new Error(
    '400 {"type":"error","error":{"type":"invalid_request_error","message":' +
      '"Your credit balance is too low to access the Anthropic API. Please go ' +
      'to Plans & Billing to upgrade or purchase credits."}}',
  ),
  { status: 400 },
);

describe('SaudeIaService.classificar', () => {
  it('reconhece saldo zerado', () => {
    expect(SaudeIaService.classificar(ERRO_SALDO)).toBe('credito');
  });

  it('reconhece chave recusada por codigo, sem depender do texto', () => {
    for (const status of [401, 403]) {
      const erro = Object.assign(new Error('nao importa o texto'), { status });
      expect(SaudeIaService.classificar(erro)).toBe('autenticacao');
    }
  });

  it('ignora 400 comum — nao pode virar alerta de fatura', () => {
    const erro = Object.assign(
      new Error('400 {"error":{"message":"max_tokens: invalid value"}}'),
      { status: 400 },
    );
    expect(SaudeIaService.classificar(erro)).toBeUndefined();
  });

  it('ignora rate limit: passa sozinho e treinaria voce a ignorar o alerta', () => {
    const erro = Object.assign(new Error('429 rate_limit_error'), {
      status: 429,
    });
    expect(SaudeIaService.classificar(erro)).toBeUndefined();
  });

  it('ignora erro de rede e valores estranhos sem quebrar', () => {
    expect(SaudeIaService.classificar(new Error('socket hang up'))).toBeUndefined();
    expect(SaudeIaService.classificar(undefined)).toBeUndefined();
    expect(SaudeIaService.classificar(null)).toBeUndefined();
    expect(SaudeIaService.classificar('erro em texto')).toBeUndefined();
  });
});

describe('SaudeIaService', () => {
  it('avisa na primeira falha e cala enquanto a queda durar', () => {
    const servico = new SaudeIaService();
    const ouvinte = jest.fn();
    servico.aoFalhar(ouvinte);

    // Durante uma queda, cada mensagem de cada cliente cai no mesmo erro:
    // sem a trava, seriam dezenas de e-mails identicos.
    servico.registrarFalha(ERRO_SALDO);
    servico.registrarFalha(ERRO_SALDO);
    servico.registrarFalha(ERRO_SALDO);

    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(ouvinte).toHaveBeenCalledWith('credito', expect.stringContaining('credit balance'));
  });

  it('volta a avisar depois que a IA se recupera e cai de novo', () => {
    const servico = new SaudeIaService();
    const ouvinte = jest.fn();
    servico.aoFalhar(ouvinte);

    servico.registrarFalha(ERRO_SALDO);
    servico.registrarSucesso(); // creditos comprados, servico normalizado
    servico.registrarFalha(ERRO_SALDO); // acabou de novo

    expect(ouvinte).toHaveBeenCalledTimes(2);
  });

  it('avisa separadamente quando a causa muda', () => {
    const servico = new SaudeIaService();
    const ouvinte = jest.fn();
    servico.aoFalhar(ouvinte);

    servico.registrarFalha(ERRO_SALDO);
    servico.registrarFalha(
      Object.assign(new Error('401 authentication_error'), { status: 401 }),
    );

    expect(ouvinte.mock.calls.map((c) => c[0])).toEqual([
      'credito',
      'autenticacao',
    ]);
  });

  it('nao dispara para erro que afeta uma conversa so', () => {
    const servico = new SaudeIaService();
    const ouvinte = jest.fn();
    servico.aoFalhar(ouvinte);

    servico.registrarFalha(new Error('socket hang up'));

    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('ouvinte que quebra nao propaga para quem esta atendendo o cliente', () => {
    const servico = new SaudeIaService();
    const quebrado = jest.fn(() => {
      throw new Error('e-mail fora do ar');
    });
    const bom = jest.fn();
    servico.aoFalhar(quebrado);
    servico.aoFalhar(bom);

    // Chamado de dentro do catch que responde ao cliente: telemetria nunca
    // pode piorar o erro que ja esta acontecendo.
    expect(() => servico.registrarFalha(ERRO_SALDO)).not.toThrow();
    expect(bom).toHaveBeenCalledTimes(1);
  });

  it('registrarSucesso sem falha anterior nao faz nada', () => {
    const servico = new SaudeIaService();
    const ouvinte = jest.fn();
    servico.aoFalhar(ouvinte);

    servico.registrarSucesso();
    servico.registrarSucesso();

    expect(ouvinte).not.toHaveBeenCalled();
  });
});
