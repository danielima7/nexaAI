import { ConfigService } from '@nestjs/config';
import { SuporteService } from './suporte.service';

/**
 * Link de suporte por WhatsApp.
 *
 * O que estes testes protegem: o botao so pode aparecer quando ha um numero
 * utilizavel. Um link quebrado leva o cliente a uma tela de erro do WhatsApp
 * exatamente no momento em que ele precisa de ajuda — pior do que nao ter
 * botao nenhum, porque queima a confianca em vez de so faltar um recurso.
 */
describe('SuporteService (link de WhatsApp)', () => {
  const criar = (valor?: string): SuporteService =>
    new SuporteService({
      get: () => valor,
    } as unknown as ConfigService);

  describe('quando nao ha numero utilizavel', () => {
    it.each([
      ['ausente', undefined],
      ['vazio', ''],
      ['so espacos', '   '],
      ['sem digito nenhum', 'meu-whatsapp'],
      ['curto demais', '5524999'],
      ['longo demais', '5524999990000123456'],
    ])('fica inativo: %s', (_caso, valor) => {
      const s = criar(valor as string | undefined);
      expect(s.ativo).toBe(false);
      expect(s.link()).toBeUndefined();
    });

    it('devolve rodape VAZIO, para o e-mail poder concatenar sem checar', () => {
      expect(criar(undefined).rodapeEmail()).toBe('');
    });
  });

  describe('normalizacao', () => {
    it.each([
      ['5524999990000', '5524999990000'],
      ['+55 (24) 99999-0000', '5524999990000'],
      ['  55 24 99999 0000  ', '5524999990000'],
    ])('aceita %s como o usuario escreveria', (entrada, esperado) => {
      expect(criar(entrada).link()).toBe(`https://wa.me/${esperado}`);
    });
  });

  describe('mensagem pre-preenchida', () => {
    it('vai codificada na URL', () => {
      const url = criar('5524999990000').link('Ola! Preciso de ajuda.');
      expect(url).toBe(
        'https://wa.me/5524999990000?text=Ola!%20Preciso%20de%20ajuda.',
      );
    });

    it('escapa caracteres que quebrariam a query string', () => {
      const url = criar('5524999990000').link('conta & senha?#agora');
      expect(url).toContain('%26'); // &
      expect(url).toContain('%3F'); // ?
      expect(url).toContain('%23'); // #
    });
  });

  it('o rodape de e-mail carrega o link e se separa do corpo', () => {
    const rodape = criar('5524999990000').rodapeEmail();
    expect(rodape).toContain('https://wa.me/5524999990000');
    expect(rodape.startsWith('\n\n---\n')).toBe(true);
  });
});
