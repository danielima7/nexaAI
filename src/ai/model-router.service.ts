import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * De onde partiu a chamada a IA. Nao e a audiencia (que decide QUAIS
 * ferramentas existem) nem o tenant — e o tipo de trabalho pedido, que e o
 * unico criterio honesto para escolher modelo.
 */
export type RotaIa =
  | 'chat'
  | 'whatsapp'
  | 'resumo_diario'
  | 'alerta'
  | 'instagram_dm';

/** Faixa de custo/capacidade. O model ID de cada faixa vem do .env. */
type Faixa = 'principal' | 'economico';

/** Configuracao de requisicao ja resolvida para uma rota. */
export interface PerfilModelo {
  model: string;
  maxTokens: number;
  /** Ausente quando o modelo nao aceita o parametro (ver CAPACIDADES). */
  outputConfig?: Anthropic.OutputConfig;
}

interface Capacidades {
  /**
   * Se o modelo raciocina quando `thinking` e OMITIDO da requisicao.
   *
   * Importa porque max_tokens limita raciocinio + texto SOMADOS: em um modelo
   * que pensa por padrao, um teto apertado e consumido pelo raciocinio e a
   * resposta chega truncada, sem erro nenhum. E a diferenca entre Opus 4.8
   * (nao pensa) e Sonnet 5 / Opus 5 (pensam).
   */
  pensaPorPadrao: boolean;
  /**
   * Se aceita `output_config.effort`. Geracao 4.6+ aceita; a 4.5 devolve 400.
   * Por isso Haiku 4.5 nao pode receber o mesmo payload dos demais.
   */
  aceitaEffort: boolean;
}

/**
 * Modelos homologados para o payload que o AiService monta hoje.
 *
 * Existe como registro fechado, e nao como string livre do .env, porque trocar
 * ANTHROPIC_MODEL e uma edicao de uma linha e as familias NAO sao
 * intercambiaveis: apontar para um modelo que pensa por padrao sem ajustar
 * max_tokens trunca respostas silenciosamente, e mandar `effort` para a
 * geracao 4.5 quebra toda chamada. Um modelo desconhecido derruba o boot em
 * vez de degradar em producao.
 */
const CAPACIDADES: Record<string, Capacidades> = {
  'claude-opus-4-8': { pensaPorPadrao: false, aceitaEffort: true },
  'claude-opus-5': { pensaPorPadrao: true, aceitaEffort: true },
  'claude-sonnet-5': { pensaPorPadrao: true, aceitaEffort: true },
  'claude-haiku-4-5': { pensaPorPadrao: false, aceitaEffort: false },
};

/**
 * Faixa de cada rota.
 *
 * O criterio e o que a IA precisa DECIDIR, nao o quanto o texto importa:
 * - `alerta` recebe um resultado que o AlertService ja comparou em codigo puro
 *   e so redige o aviso;
 * - `instagram_dm` roda com audiencia publica, que enxerga ZERO ferramentas, e
 *   responde restrita as instrucoes do dono.
 * Nenhuma das duas escolhe ferramenta, entao nao ha capacidade agentica a
 * perder ao baratear. As demais escolhem entre as 58 e ficam na faixa cara.
 */
const FAIXA_POR_ROTA: Record<RotaIa, Faixa> = {
  chat: 'principal',
  whatsapp: 'principal',
  resumo_diario: 'principal',
  alerta: 'economico',
  instagram_dm: 'economico',
};

/**
 * Teto de saida por faixa.
 *
 * Os 1024 anteriores eram apertados ate para Opus 4.8: resposta cortada vira
 * nova pergunta do usuario, e uma segunda chamada custa mais que a folga. Como
 * max_tokens e teto e nao meta, sobrar nao gera gasto — so cobra o que sai.
 */
const MAX_TOKENS: Record<Faixa, number> = {
  principal: 4096,
  economico: 2048,
};

/**
 * Esforco pedido na faixa principal, quando o modelo aceita o parametro.
 *
 * `medium` porque o trabalho do Katalli e escolher entre ferramentas conhecidas
 * e resumir o retorno — nao raciocinio longo. O padrao da API e `high`, que
 * gera tokens de raciocinio cobrados como saida sem ganho pratico aqui.
 */
const ESFORCO_PRINCIPAL = 'medium' as const;

/**
 * Decide qual modelo atende cada rota.
 *
 * Deliberadamente uma tabela, e nao um classificador com IA: um classificador
 * custaria uma chamada extra e ~1s de latencia em TODA mensagem do chat, que e
 * o canal principal, para adivinhar o que a rota ja diz de graca.
 *
 * A resolucao acontece uma vez por turno e vale para o loop inteiro de tool
 * use. O cache de prompt e por modelo — alternar no meio da conversa jogaria
 * fora o prefixo de ~10K tokens de ferramentas e pagaria escrita (1,25x) a
 * cada troca, que e justamente o que o roteamento tenta economizar.
 */
@Injectable()
export class ModelRouterService implements OnModuleInit {
  private readonly logger = new Logger(ModelRouterService.name);
  private readonly modeloPorFaixa: Record<Faixa, string>;

  constructor(private readonly config: ConfigService) {
    // ANTHROPIC_MODEL continua valendo como principal para nao quebrar
    // instalacoes existentes nem o .env de producao.
    this.modeloPorFaixa = {
      principal:
        this.config.get<string>('KATALLI_MODELO_PRINCIPAL') ??
        this.config.get<string>('ANTHROPIC_MODEL') ??
        'claude-opus-4-8',
      economico:
        this.config.get<string>('KATALLI_MODELO_ECONOMICO') ??
        'claude-haiku-4-5',
    };
  }

  /**
   * Falha no boot se algum modelo configurado for desconhecido.
   *
   * Preferimos nao subir a subir servindo respostas truncadas ou quebrando
   * toda chamada de uma rota — os dois modos de falha de um model ID trocado
   * sao silenciosos em runtime.
   */
  onModuleInit(): void {
    for (const [faixa, model] of Object.entries(this.modeloPorFaixa)) {
      if (!CAPACIDADES[model]) {
        throw new Error(
          `Modelo nao homologado na faixa "${faixa}": "${model}". ` +
            `Homologados: ${Object.keys(CAPACIDADES).join(', ')}. ` +
            `Para adicionar um modelo novo, declare as capacidades dele em CAPACIDADES ` +
            `(model-router.service.ts) apos conferir se ele raciocina por padrao e se aceita effort.`,
        );
      }
    }

    this.logger.log(
      `Modelos: principal=${this.modeloPorFaixa.principal} economico=${this.modeloPorFaixa.economico}`,
    );
  }

  /** Resolve o perfil de requisicao de uma rota. */
  resolver(rota: RotaIa): PerfilModelo {
    const faixa = FAIXA_POR_ROTA[rota];
    const model = this.modeloPorFaixa[faixa];
    const capacidades = CAPACIDADES[model];

    const perfil: PerfilModelo = {
      model,
      maxTokens: MAX_TOKENS[faixa],
    };

    // `effort` so acompanha a faixa principal: na economica o objetivo e gasto
    // minimo, que ja e o comportamento sem o parametro.
    if (faixa === 'principal' && capacidades.aceitaEffort) {
      perfil.outputConfig = { effort: ESFORCO_PRINCIPAL };
    }

    return perfil;
  }
}
