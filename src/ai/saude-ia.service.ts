import { Injectable, Logger } from '@nestjs/common';

/**
 * Falhas que derrubam TODAS as conversas de uma vez, nao apenas uma.
 *
 *  - `credito`: saldo da conta Anthropic zerado.
 *  - `autenticacao`: chave invalida, revogada ou sem permissao.
 *
 * O que as une nao e a causa, e a consequencia: nenhum cliente consegue usar o
 * produto, e nenhum deles vai saber por que. Erro de uma conversa so (timeout,
 * 500 esporadico, ferramenta que falhou) NAO entra aqui — avisar a cada
 * soluco deixaria o aviso barato e voce pararia de ler.
 */
export type FalhaGlobal = 'credito' | 'autenticacao';

/** Quem quer ser avisado quando a IA para de atender. */
export type OuvinteDeFalha = (
  tipo: FalhaGlobal,
  detalhe: string,
) => void | Promise<void>;

/**
 * Vigia a disponibilidade da IA e avisa na hora em que ela cai por inteiro.
 *
 * Por que existe: ate aqui, saldo zerado virava um `logger.error` e um
 * "Tive um problema, tente de novo" para o cliente. O chat ficava mudo para
 * todo mundo e a unica forma de descobrir era alguem reclamar — foi assim que
 * descobrimos da ultima vez. O monitor de custo nao cobre isso: ele compara
 * gasto do DIA com um teto, e saldo que acaba devagar nunca encosta nesse teto.
 *
 * Mora no AiModule, e nao junto do envio de e-mail, para nao inverter a
 * dependencia: quem detecta e quem chama a API. Quem avisa se inscreve.
 */
@Injectable()
export class SaudeIaService {
  private readonly logger = new Logger(SaudeIaService.name);

  private readonly ouvintes: OuvinteDeFalha[] = [];

  /**
   * Tipo de falha ja notificado, enquanto ela durar.
   *
   * Serve de trava contra repeticao: durante uma queda, cada mensagem de cada
   * cliente cairia no mesmo erro e geraria um e-mail. Uma chamada bem-sucedida
   * limpa a trava, entao uma recaida depois da recuperacao avisa de novo.
   */
  private notificada?: FalhaGlobal;

  /** Registra interesse em ser avisado. Chamado no boot, nao por requisicao. */
  aoFalhar(ouvinte: OuvinteDeFalha): void {
    this.ouvintes.push(ouvinte);
  }

  /** Chamada da API respondeu: o servico esta de pe de novo. */
  registrarSucesso(): void {
    if (this.notificada) {
      this.logger.log(
        `IA voltou a responder (a falha anterior era "${this.notificada}").`,
      );
      this.notificada = undefined;
    }
  }

  /**
   * Classifica um erro da API e dispara o aviso quando ele for global.
   *
   * Nao lanca e nao retorna nada util de proposito: e chamado de dentro do
   * `catch` que atende o cliente, e telemetria nunca pode piorar o erro que
   * ja esta acontecendo.
   */
  registrarFalha(erro: unknown): void {
    const tipo = SaudeIaService.classificar(erro);
    if (!tipo) return;

    if (this.notificada === tipo) return; // ja avisei, a queda continua

    this.notificada = tipo;

    const detalhe = erro instanceof Error ? erro.message : String(erro);
    this.logger.error(
      `IA INDISPONIVEL PARA TODOS OS CLIENTES (${tipo}): ${detalhe}`,
    );

    for (const ouvinte of this.ouvintes) {
      try {
        // Sem await: o cliente esta esperando uma resposta HTTP. O envio de
        // e-mail leva segundos e nao pode entrar no caminho da requisicao.
        void Promise.resolve(ouvinte(tipo, detalhe)).catch((e: unknown) => {
          const d = e instanceof Error ? e.message : String(e);
          this.logger.error(`Ouvinte de falha da IA quebrou: ${d}`);
        });
      } catch (e: unknown) {
        const d = e instanceof Error ? e.message : String(e);
        this.logger.error(`Ouvinte de falha da IA quebrou: ${d}`);
      }
    }
  }

  /**
   * Traduz o erro do SDK para um dos tipos globais.
   *
   * O saldo zerado chega como 400 `invalid_request_error` — o mesmo codigo de
   * um parametro errado — entao o texto da mensagem e o UNICO sinal que
   * distingue os dois. Casar por texto e fragil, e por isso o padrao e nao
   * avisar: se a Anthropic reescrever a frase, voltamos ao silencio de hoje,
   * que e ruim mas conhecido. Um falso positivo, ao contrario, mandaria voce
   * conferir a fatura por causa de um typo em `max_tokens`.
   *
   * 401 e 403 sao seguros por codigo: chave invalida ou sem permissao derruba
   * tudo, e nao ha ambiguidade.
   *
   * 429 fica de fora: rate limit passa sozinho, e avisar sobre ele treinaria
   * voce a ignorar o alerta.
   */
  static classificar(erro: unknown): FalhaGlobal | undefined {
    const status = (erro as { status?: number } | null)?.status;
    const texto = (
      erro instanceof Error ? erro.message : String(erro ?? '')
    ).toLowerCase();

    if (status === 401 || status === 403) return 'autenticacao';

    if (texto.includes('credit balance') || texto.includes('purchase credits')) {
      return 'credito';
    }

    return undefined;
  }
}
