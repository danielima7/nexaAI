import { Injectable, Logger } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { planoDe } from './planos';

/** O que interessa da organizacao para decidir se ela pode enviar. */
export interface OrganizacaoParaLimite {
  id: string;
  plano: string;
  limiteTokensDia: number | null;
  limiteInteracoes: number | null;
}

/** Decisao sobre uma mensagem. `motivo` so vem quando bloqueada. */
export interface Veredito {
  permitido: boolean;
  /** Texto pronto para o cliente ler no chat. */
  motivo?: string;
}

/**
 * Decide se uma organizacao ainda pode enviar mensagem.
 *
 * Centraliza os dois limites que existem, que respondem perguntas diferentes:
 *
 *  - COTA DIARIA DE TOKENS (plano): renova a cada dia. E o mecanismo do
 *    cliente pagante — protege a margem sem nunca encerrar o servico.
 *  - TETO TOTAL DE MENSAGENS (trial): nao renova. E o "experimente o produto"
 *    das contas de autocadastro.
 *
 * Ficam juntos aqui, e nao espalhados em `if`s no controller, porque limite
 * novo tende a ser esquecido em algum caminho — e limite que vale so as vezes
 * nao e limite. Quem chama a IA pergunta uma coisa so: pode?
 */
@Injectable()
export class LimiteUsoService {
  private readonly logger = new Logger(LimiteUsoService.name);

  constructor(private readonly uso: AiUsageService) {}

  /** Cota diaria efetiva: override da organizacao ou a do plano. */
  cotaDiaria(org: Pick<OrganizacaoParaLimite, 'plano' | 'limiteTokensDia'>): number | null {
    // O override vence o plano, inclusive quando e menor — e assim que se
    // segura um cliente que esta consumindo demais sem rebaixar o plano dele.
    if (org.limiteTokensDia !== null && org.limiteTokensDia !== undefined) {
      return org.limiteTokensDia;
    }
    return planoDe(org.plano).tokensDia;
  }

  /**
   * Pode enviar mais uma mensagem?
   *
   * Chamado ANTES da IA. Verificar depois apenas registraria o gasto que ja
   * aconteceu — que e exatamente o que o limite existe para impedir.
   */
  async verificar(org: OrganizacaoParaLimite): Promise<Veredito> {
    // 1. Trial primeiro: se a conta nem deveria estar usando, a cota diaria e
    // irrelevante — e a mensagem certa fala de plano, nao de tokens.
    if (org.limiteInteracoes !== null && org.limiteInteracoes !== undefined) {
      const usadas = await this.uso.contarInteracoes(org.id);
      if (usadas >= org.limiteInteracoes) {
        return {
          permitido: false,
          motivo:
            `Você usou as ${org.limiteInteracoes} mensagens da conta gratuita.\n\n` +
            'Seus dados e integrações continuam salvos. Para liberar o uso ' +
            'completo, fale com a gente pelo WhatsApp no rodapé do site — ' +
            'respondemos no mesmo dia.',
        };
      }
    }

    // 2. Cota diaria do plano.
    const cota = this.cotaDiaria(org);
    if (cota === null) return { permitido: true };

    const usados = await this.uso.tokensDoDia(org.id);
    if (usados < cota) return { permitido: true };

    this.logger.warn(
      `Organizacao ${org.id} atingiu a cota diaria (${usados}/${cota} tokens, plano "${org.plano}").`,
    );

    return {
      permitido: false,
      motivo:
        'Você atingiu o limite de uso de hoje.\n\n' +
        'A cota renova automaticamente amanhã de manhã, e seus dados e ' +
        'integrações continuam como estão. Se isso está atrapalhando o seu ' +
        'dia a dia, fale com a gente pelo WhatsApp — dá para ajustar o seu plano.',
    };
  }

  /** Quanto resta hoje. Para telas e diagnostico, nao para bloquear. */
  async situacao(org: OrganizacaoParaLimite): Promise<{
    cota: number | null;
    usados: number;
    restante: number | null;
    percentual: number | null;
  }> {
    const cota = this.cotaDiaria(org);
    const usados = await this.uso.tokensDoDia(org.id);
    return {
      cota,
      usados,
      restante: cota === null ? null : Math.max(0, cota - usados),
      percentual: cota === null ? null : Math.round((usados / cota) * 100),
    };
  }
}
