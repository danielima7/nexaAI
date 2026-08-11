/**
 * Planos comerciais do Katalli e a cota diaria de tokens de cada um.
 *
 * Mora em codigo, e nao no banco, por dois motivos:
 *
 * 1. Reajustar a cota de um plano deve valer para todos os clientes dele de
 *    uma vez. Numa coluna por organizacao, cada reajuste viraria um UPDATE em
 *    massa — e quem esquecesse uma linha teria um cliente com cota errada.
 * 2. A cota entra em contrato. Versionada junto do codigo, da para saber o que
 *    valia em qualquer data olhando o historico do git.
 *
 * Override por cliente continua possivel: `Organization.limiteTokensDia`.
 */

/** Um plano e o que ele oferece por dia. */
export interface Plano {
  /** Nome exibido ao cliente. */
  nome: string;
  /**
   * Teto de tokens por dia. `null` = sem teto.
   *
   * Conta a SOMA de todos os tokens da chamada — entrada, saida e cache. E o
   * volume que a Anthropic mede, e o unico numero que da para explicar ao
   * cliente sem falar de precificacao de cache.
   */
  tokensDia: number | null;
}

/**
 * Plano de quem ainda nao tem plano definido.
 *
 * Hoje todos os clientes estao aqui, de proposito: enquanto nao houver
 * precificacao por faixa, cobrar limites diferentes de gente que paga o mesmo
 * seria arbitrario. A estrutura ja existe para o dia em que houver.
 */
export const PLANO_PADRAO = 'padrao';

export const PLANOS: Record<string, Plano> = {
  /**
   * 1.000.000 de tokens/dia.
   *
   * Dimensionado a partir do consumo medido: uma interacao real do Katalli
   * gasta ~40-60 mil tokens somando entrada, saida e cache (o prefixo de
   * ferramentas domina). Isso da folga para ~20 perguntas por dia — acima do
   * que um dono de PME faz em uso normal, e baixo o suficiente para que um
   * script em loop bata no teto antes de virar prejuizo.
   *
   * Reveja este numero quando o piloto der uso real: `npm run custo`.
   */
  [PLANO_PADRAO]: { nome: 'Padrao', tokensDia: 1_000_000 },
};

/**
 * Cota de um plano. Plano desconhecido cai no padrao, nao em ilimitado.
 *
 * Fail-safe na direcao certa: um valor digitado errado no banco nao pode
 * liberar consumo infinito — o erro apareceria so na fatura.
 */
export function planoDe(nome: string | null | undefined): Plano {
  return PLANOS[nome ?? ''] ?? PLANOS[PLANO_PADRAO];
}
