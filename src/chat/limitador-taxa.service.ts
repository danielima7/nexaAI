import { Injectable, Logger } from '@nestjs/common';

/** Uma regra de limite: quantas vezes, em quanto tempo. */
export interface Regra {
  /** Nome curto, usado no log quando alguem estoura. */
  nome: string;
  max: number;
  janelaMs: number;
}

interface Contador {
  contador: number;
  reiniciaEm: number;
}

/**
 * Limite de requisicoes por origem, em memoria.
 *
 * Em memoria porque o processo e unico e o objetivo e conter abuso obvio —
 * script em loop, alguem descobrindo a rota publica de cadastro. Nao substitui
 * um WAF, e um reinicio zera as contagens; ambos aceitaveis para o que ele
 * protege. Quando houver mais de uma instancia, isto vira Redis.
 *
 * Existe separado do ChatAuthService (que ja limitava login) porque as regras
 * sao diferentes: errar a senha e barato, criar organizacao e chamar a IA nao.
 * Compartilhar o mesmo balde faria uma tentativa de login gastar a cota de
 * criacao de conta.
 */
@Injectable()
export class LimitadorTaxaService {
  private readonly logger = new Logger(LimitadorTaxaService.name);

  /**
   * Teto de chaves guardadas.
   *
   * Um Map indexado por IP cresce para sempre: quem rotaciona endereco criaria
   * uma entrada nova a cada requisicao ate derrubar o processo por memoria. Ao
   * bater no teto, limpamos o que ja expirou; se ainda assim estiver cheio,
   * zeramos tudo — perder contagem e melhor que cair.
   */
  private static readonly MAX_CHAVES = 20_000;

  private readonly baldes = new Map<string, Contador>();

  /**
   * Consome uma unidade da cota. `false` = estourou, bloqueie.
   *
   * A chave deve incluir a regra E a origem, para que limites diferentes nao
   * disputem o mesmo contador.
   */
  permitir(origem: string, regra: Regra): boolean {
    const agora = Date.now();
    const chave = `${regra.nome}:${origem}`;

    if (this.baldes.size >= LimitadorTaxaService.MAX_CHAVES) this.limpar(agora);

    const atual = this.baldes.get(chave);

    if (!atual || agora > atual.reiniciaEm) {
      this.baldes.set(chave, { contador: 1, reiniciaEm: agora + regra.janelaMs });
      return true;
    }

    atual.contador++;

    if (atual.contador > regra.max) {
      // Loga so na virada, nao a cada requisicao bloqueada: um loop geraria
      // milhares de linhas identicas e afogaria o resto do log.
      if (atual.contador === regra.max + 1) {
        this.logger.warn(
          `Limite "${regra.nome}" estourado por ${origem} ` +
            `(${regra.max} em ${Math.round(regra.janelaMs / 1000)}s).`,
        );
      }
      return false;
    }

    return true;
  }

  /** Quantos segundos faltam para a origem poder tentar de novo. */
  segundosParaLiberar(origem: string, regra: Regra): number {
    const atual = this.baldes.get(`${regra.nome}:${origem}`);
    if (!atual) return 0;
    return Math.max(0, Math.ceil((atual.reiniciaEm - Date.now()) / 1000));
  }

  /** Descarta janelas vencidas; se nao sobrar espaco, zera. */
  private limpar(agora: number): void {
    for (const [chave, c] of this.baldes) {
      if (agora > c.reiniciaEm) this.baldes.delete(chave);
    }

    if (this.baldes.size >= LimitadorTaxaService.MAX_CHAVES) {
      this.logger.warn(
        `Limitador cheio com ${this.baldes.size} chaves ativas; zerando as contagens.`,
      );
      this.baldes.clear();
    }
  }
}

/**
 * Regras em uso.
 *
 * Os numeros saem do custo de cada acao, nao de um padrao generico:
 *
 * - MENSAGEM: 20/min por organizacao. Uma pessoa conversando nao passa de 3 ou
 *   4; 20 e folga larga para quem digita rapido e teto apertado para um script.
 *   A cota diaria de tokens ja limita o gasto do dia — isto impede que ela seja
 *   consumida inteira em segundos e que a API leve uma rajada.
 *
 * - CADASTRO: 3/hora por IP. Criar organizacao e a acao mais cara da rota
 *   publica, porque cada uma nasce com direito a mensagens gratuitas. Tres por
 *   hora atende uma pessoa que errou e refez; nao atende quem automatiza.
 */
export const REGRAS = {
  MENSAGEM: { nome: 'chat', max: 20, janelaMs: 60_000 },
  CADASTRO: { nome: 'cadastro', max: 3, janelaMs: 60 * 60_000 },
} as const;
