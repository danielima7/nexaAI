import { ConfigService } from '@nestjs/config';
import { ModelRouterService, RotaIa } from './model-router.service';

/**
 * Politica de modelo por rota.
 *
 * Estes testes protegem tres decisoes que falham de forma SILENCIOSA em
 * producao — sem excecao, sem log de erro, so custo maior ou resposta pior:
 *
 * 1. rota barata que volta a cair na faixa cara (a margem some sem aviso);
 * 2. `effort` enviado para um modelo da geracao 4.5 (400 em toda chamada
 *    daquela rota — o alerta simplesmente para de sair);
 * 3. teto de saida de volta a 1024 (resposta truncada no meio, que o usuario
 *    percebe como "a IA nao terminou" e nao como bug).
 */
describe('ModelRouterService (politica de modelo por rota)', () => {
  const configFalso = (valores: Record<string, string> = {}): ConfigService =>
    ({
      get: (chave: string) => valores[chave],
    }) as unknown as ConfigService;

  const criar = (valores?: Record<string, string>): ModelRouterService => {
    const router = new ModelRouterService(configFalso(valores));
    router.onModuleInit();
    return router;
  };

  describe('faixa por rota', () => {
    const principais: RotaIa[] = ['chat', 'whatsapp', 'resumo_diario'];
    const economicas: RotaIa[] = ['alerta', 'instagram_dm'];

    it.each(principais)(
      'rota "%s" escolhe ferramentas, entao usa a faixa principal',
      (rota) => {
        const router = criar({
          KYRIUS_MODELO_PRINCIPAL: 'claude-sonnet-5',
          KYRIUS_MODELO_ECONOMICO: 'claude-haiku-4-5',
        });
        expect(router.resolver(rota).model).toBe('claude-sonnet-5');
      },
    );

    it.each(economicas)(
      'rota "%s" nao escolhe ferramenta, entao usa a faixa economica',
      (rota) => {
        const router = criar({
          KYRIUS_MODELO_PRINCIPAL: 'claude-sonnet-5',
          KYRIUS_MODELO_ECONOMICO: 'claude-haiku-4-5',
        });
        expect(router.resolver(rota).model).toBe('claude-haiku-4-5');
      },
    );
  });

  describe('parametros por geracao de modelo', () => {
    it('nao manda effort para Haiku 4.5: a geracao 4.5 devolve 400', () => {
      const router = criar({ KYRIUS_MODELO_ECONOMICO: 'claude-haiku-4-5' });
      expect(router.resolver('alerta').outputConfig).toBeUndefined();
    });

    it('manda effort quando o modelo da faixa principal aceita', () => {
      const router = criar({ KYRIUS_MODELO_PRINCIPAL: 'claude-sonnet-5' });
      expect(router.resolver('chat').outputConfig).toEqual({
        effort: 'medium',
      });
    });

    it('mesmo na faixa principal, nao manda effort a um modelo que nao aceita', () => {
      // Cenario real: alguem coloca um modelo barato como principal para testar.
      const router = criar({ KYRIUS_MODELO_PRINCIPAL: 'claude-haiku-4-5' });
      expect(router.resolver('chat').outputConfig).toBeUndefined();
    });
  });

  describe('teto de saida', () => {
    it('da folga acima dos 1024 antigos em toda rota', () => {
      const router = criar();
      const rotas: RotaIa[] = [
        'chat',
        'whatsapp',
        'resumo_diario',
        'alerta',
        'instagram_dm',
      ];
      for (const rota of rotas) {
        expect(router.resolver(rota).maxTokens).toBeGreaterThan(1024);
      }
    });

    it('a faixa principal tem mais folga: nela o modelo pode raciocinar antes de responder', () => {
      const router = criar();
      expect(router.resolver('chat').maxTokens).toBeGreaterThan(
        router.resolver('alerta').maxTokens,
      );
    });
  });

  describe('configuracao', () => {
    it('respeita ANTHROPIC_MODEL como principal (instalacoes existentes)', () => {
      const router = criar({ ANTHROPIC_MODEL: 'claude-opus-4-8' });
      expect(router.resolver('chat').model).toBe('claude-opus-4-8');
    });

    it('KYRIUS_MODELO_PRINCIPAL tem precedencia sobre ANTHROPIC_MODEL', () => {
      const router = criar({
        ANTHROPIC_MODEL: 'claude-opus-4-8',
        KYRIUS_MODELO_PRINCIPAL: 'claude-sonnet-5',
      });
      expect(router.resolver('chat').model).toBe('claude-sonnet-5');
    });

    it('sem nada configurado, mantem o comportamento atual de producao', () => {
      const router = criar();
      expect(router.resolver('chat').model).toBe('claude-opus-4-8');
    });

    it('derruba o boot com modelo desconhecido, em vez de falhar em runtime', () => {
      // Trocar ANTHROPIC_MODEL e uma edicao de uma linha no .env, e um modelo
      // de outra geracao quebra silenciosamente (thinking consumindo o teto de
      // saida, ou 400 por causa do effort). Melhor nao subir.
      const router = new ModelRouterService(
        configFalso({ ANTHROPIC_MODEL: 'claude-opus-5-turbo-inventado' }),
      );
      expect(() => router.onModuleInit()).toThrow(/nao homologado/i);
    });
  });
});
