import { ValidadorConexoesService } from './validador-conexoes.service';
import { ConnectionsService } from '../connections/connections.service';
import { GoogleService } from '../integrations/google/google.service';
import { InstagramService } from '../integrations/instagram/instagram.service';

/**
 * A decisao que este service toma manda — ou nao manda — o cliente refazer um
 * OAuth. Errar para "expirada" gasta a paciencia dele com uma autorizacao que
 * estava boa; errar para "ok" deixa o painel quebrado sem ninguem saber.
 */
describe('ValidadorConexoesService.pareceExpirada', () => {
  it('reconhece o erro real do Google quando a autorizacao morre', () => {
    // Medido tres vezes nesta base, com a tela de consentimento em "Testing".
    expect(ValidadorConexoesService.pareceExpirada('invalid_grant')).toBe(true);
  });

  it('reconhece os erros de autorizacao do Meta', () => {
    expect(
      ValidadorConexoesService.pareceExpirada(
        'OAuthException: Session has been invalidated',
      ),
    ).toBe(true);
    expect(ValidadorConexoesService.pareceExpirada('Error 401 Unauthorized')).toBe(
      true,
    );
  });

  it('NAO trata falha de rede como autorizacao morta', () => {
    // Pedir reconexao por causa de rede instavel ensina o cliente a ignorar
    // o aviso — e no dia em que for de verdade ele nao age.
    for (const m of [
      'socket hang up',
      'ETIMEDOUT',
      'getaddrinfo ENOTFOUND',
      'tempo esgotado na verificacao',
      'Internal Server Error',
      '503 Service Unavailable',
    ]) {
      expect(ValidadorConexoesService.pareceExpirada(m)).toBe(false);
    }
  });

  it('e insensivel a caixa', () => {
    expect(ValidadorConexoesService.pareceExpirada('INVALID_GRANT')).toBe(true);
  });
});

describe('ValidadorConexoesService.verificar', () => {
  function montar(opcoes: {
    token?: string | undefined;
    tokenLanca?: boolean;
    erroDoProvedor?: Error;
  }) {
    const connections = {
      resolveToken: jest.fn(async () => {
        if (opcoes.tokenLanca) throw new Error('Envelope malformado');
        return opcoes.token;
      }),
      listProviders: jest.fn().mockResolvedValue(['google']),
    } as unknown as ConnectionsService;

    const google = {
      authorizedClient: () => ({
        getAccessToken: async () => {
          if (opcoes.erroDoProvedor) throw opcoes.erroDoProvedor;
          return { token: 'ok' };
        },
      }),
    } as unknown as GoogleService;

    const instagram = {
      getPerfil: jest.fn(),
    } as unknown as InstagramService;

    return new ValidadorConexoesService(connections, google, instagram);
  }

  it('devolve ok quando o provedor aceita a credencial', async () => {
    const s = montar({ token: 'refresh-valido' });
    await expect(s.verificar('org-1', 'google')).resolves.toMatchObject({
      estado: 'ok',
    });
  });

  it('devolve ausente quando nao ha credencial guardada', async () => {
    // Nao ter a integracao e diferente de te-la quebrada: nao vira alerta.
    const s = montar({ token: undefined });
    await expect(s.verificar('org-1', 'google')).resolves.toMatchObject({
      estado: 'ausente',
    });
  });

  it('devolve expirada com instrucao acionavel', async () => {
    const s = montar({
      token: 'refresh-morto',
      erroDoProvedor: new Error('invalid_grant'),
    });
    const d = await s.verificar('org-1', 'google');

    expect(d.estado).toBe('expirada');
    expect(d.detalhe).toContain('Reconectar');
  });

  it('devolve indeterminada — nao expirada — quando so deu erro de rede', async () => {
    const s = montar({
      token: 'refresh-valido',
      erroDoProvedor: new Error('socket hang up'),
    });
    await expect(s.verificar('org-1', 'google')).resolves.toMatchObject({
      estado: 'indeterminada',
    });
  });

  it('trata credencial ilegivel como expirada', async () => {
    // A chave de cifra mudou ou o registro corrompeu: so reconectar resolve.
    const s = montar({ tokenLanca: true });
    await expect(s.verificar('org-1', 'google')).resolves.toMatchObject({
      estado: 'expirada',
    });
  });

  it('ignora provedor que nao sabemos verificar, sem inventar diagnostico', async () => {
    const s = montar({ token: 'x' });
    await expect(s.verificar('org-1', 'pluggy')).resolves.toEqual({
      provedor: 'pluggy',
      estado: 'indeterminada',
    });
  });

  it('nunca lanca — a tela e o cron dependem disso', async () => {
    const s = montar({
      token: 'x',
      erroDoProvedor: new Error('qualquer coisa inesperada'),
    });
    await expect(s.verificar('org-1', 'google')).resolves.toBeDefined();
  });
});
