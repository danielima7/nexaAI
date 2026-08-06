/**
 * Compara modelos na UNICA coisa que o Katalli nao pode errar: escolher a
 * ferramenta certa entre as ~58 registradas.
 *
 * Por que existe: baratear o modelo do chat e uma decisao de margem, mas o
 * risco dela e uma regressao de escolha de ferramenta — que nao aparece em
 * teste unitario, nao lanca excecao e so se manifesta como "a IA respondeu
 * besteira" na frente de um cliente pagante. Este script transforma esse risco
 * em um numero antes da troca.
 *
 * O que NAO faz: executar ferramenta. So observa qual a IA escolheu. Nenhuma
 * API de cliente e tocada, nada e gravado no banco.
 *
 *   npm run modelo:avaliar
 *   npm run modelo:avaliar -- claude-opus-4-8 claude-sonnet-5 claude-haiku-4-5
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ModelRouterService } from '../ai/model-router.service';
import { AiUsageService } from '../ai/ai-usage.service';

import { SystemTools } from '../tools/system-tools';
import { AsaasTools } from '../integrations/asaas/asaas.tools';
import { GoogleTools } from '../integrations/google/google.tools';
import { SheetsTools } from '../integrations/google/sheets.tools';
import { HubspotTools } from '../integrations/hubspot/hubspot.tools';
import { InstagramTools } from '../integrations/instagram/instagram.tools';
import { MercadopagoTools } from '../integrations/mercadopago/mercadopago.tools';
import { PagarmeTools } from '../integrations/pagarme/pagarme.tools';
import { PluggyTools } from '../integrations/pluggy/pluggy.tools';
import { StripeTools } from '../integrations/stripe/stripe.tools';
import { AlertTools } from '../reports/alert.tools';
import { ReportTools } from '../reports/report.tools';
import { UploadTools } from '../uploads/upload.tools';

/**
 * Um caso do eval.
 *
 * `esperado` aceita varias ferramentas porque em pedidos reais mais de uma
 * escolha e defensavel ("quanto recebi hoje?" com Stripe e Asaas conectados).
 * Exigir uma unica resposta mediria obediencia a uma opiniao minha, nao
 * competencia — e o ruido esconderia a regressao que o eval procura.
 * Lista vazia = a resposta certa e NAO usar ferramenta nenhuma.
 *
 * `escrita` marca pedidos que CRIAM ou ALTERAM dado. Neles, responder em texto
 * descrevendo a acao — sem chamar ferramenta — tambem e acerto: e exatamente o
 * que o system prompt manda fazer antes de confirmar. O erro que este eval
 * procura nesses casos e chamar a ferramenta ERRADA, nao deixar de chamar.
 */
interface Caso {
  pedido: string;
  esperado: string[];
  escrita?: boolean;
}

const CASOS: Caso[] = [
  // --- Consulta financeira ---
  { pedido: 'qual meu saldo no stripe?', esperado: ['stripe_saldo'] },
  {
    pedido: 'quanto entrou de vendas no Stripe esse mes?',
    esperado: ['stripe_total_recebido', 'stripe_listar_pagamentos'],
  },
  {
    pedido: 'quais clientes estao inadimplentes?',
    esperado: ['asaas_cobrancas_vencidas'],
  },
  {
    pedido: 'quais boletos vencem essa semana?',
    esperado: ['asaas_cobrancas_a_vencer'],
  },
  {
    pedido: 'qual o saldo total das minhas contas bancarias?',
    esperado: ['pluggy_saldo_total', 'pluggy_contas'],
  },
  {
    pedido: 'me mostra as ultimas transacoes da conta do banco',
    esperado: ['pluggy_transacoes'],
  },
  {
    pedido: 'quanto recebi no mercado pago?',
    esperado: ['mercadopago_total_recebido', 'mercadopago_listar_pagamentos'],
  },
  {
    pedido: 'lista os pedidos do pagarme',
    esperado: ['pagarme_listar_pedidos'],
  },

  // --- CRM: leitura ---
  {
    pedido: 'lista as empresas cadastradas no meu CRM',
    esperado: ['hubspot_buscar_empresas'],
  },
  {
    pedido: 'quais negocios estao abertos?',
    esperado: ['hubspot_buscar_negocios'],
  },
  {
    pedido: 'acha o contato do Joao Silva',
    esperado: ['hubspot_buscar_contatos'],
  },

  // --- CRM: escrita (exige confirmacao antes de executar) ---
  {
    pedido: 'cadastre a empresa ABC Tecnologia',
    esperado: ['hubspot_criar_empresa'],
    escrita: true,
  },
  {
    pedido: 'cria uma oportunidade de R$ 80.000 para a ABC',
    esperado: ['hubspot_criar_negocio'],
    escrita: true,
  },
  {
    pedido: 'move o negocio da ABC para negociacao',
    esperado: ['hubspot_mover_negocio'],
    escrita: true,
  },
  {
    pedido: 'atualiza o telefone da empresa ABC para 24 99999-0000',
    esperado: ['hubspot_atualizar_empresa'],
    escrita: true,
  },

  // --- Google ---
  { pedido: 'tenho email novo?', esperado: ['gmail_listar_emails'] },
  {
    pedido: 'manda um email pro contador avisando que enviei os documentos',
    esperado: ['gmail_enviar_email'],
    escrita: true,
  },
  {
    pedido: 'o que tenho na agenda amanha?',
    esperado: ['google_agenda_proximos_eventos'],
  },
  {
    pedido: 'marca uma reuniao com o fornecedor sexta as 14h',
    esperado: ['google_agenda_criar_evento'],
    escrita: true,
  },

  // --- Planilhas ---
  {
    pedido: 'quais planilhas eu tenho no drive?',
    esperado: ['planilha_listar'],
  },
  {
    pedido: 'le a planilha de controle de estoque',
    esperado: ['planilha_ler', 'planilha_listar', 'planilha_listar_abas'],
  },
  {
    pedido: 'adiciona uma linha na planilha de vendas com a venda de hoje',
    esperado: ['planilha_adicionar_linha'],
    escrita: true,
  },

  // --- Sistema / configuracao ---
  {
    pedido: 'quais integracoes eu ja conectei?',
    esperado: ['katalli_listar_integracoes'],
  },
  {
    pedido: 'quero conectar minha conta do HubSpot',
    esperado: ['katalli_conectar_integracao'],
  },
  {
    pedido: 'me avisa toda vez que aparecer um cliente inadimplente novo',
    esperado: ['katalli_criar_alerta'],
    escrita: true,
  },
  {
    pedido: 'quais alertas eu tenho ativos?',
    esperado: ['katalli_listar_alertas'],
  },
  {
    pedido: 'quero receber um resumo todo dia as 8 da manha',
    esperado: ['katalli_configurar_resumo_diario'],
    escrita: true,
  },
  {
    pedido: 'o que voce fez ontem? mostra o historico de operacoes',
    esperado: ['katalli_historico_operacoes'],
  },

  // --- Instagram ---
  {
    pedido: 'como esta o desempenho do meu instagram?',
    esperado: [
      'instagram_metricas',
      'instagram_resumo_conta',
      'instagram_posts_recentes',
    ],
  },

  // --- Arquivos enviados no chat ---
  {
    pedido: 'analisa a planilha que eu subi aqui no chat',
    esperado: ['arquivo_ler', 'arquivo_listar'],
  },

  // --- Nao deve usar ferramenta ---
  // Chamar ferramenta aqui e o erro caro: gasta uma rodada extra e, se for de
  // escrita, comeca um fluxo de confirmacao que o usuario nunca pediu.
  { pedido: 'bom dia! tudo bem?', esperado: [] },
  { pedido: 'o que voce consegue fazer por mim?', esperado: [] },
  { pedido: 'obrigado, era so isso mesmo', esperado: [] },
];

/**
 * Stub das dependencias das classes *Tools.
 *
 * Devolve uma string nao-vazia para QUALQUER chamada de propriedade de
 * proposito: varias integracoes (Google, Sheets, Pluggy, Instagram) consultam
 * o ConfigService no onModuleInit e NAO se registram quando a credencial esta
 * ausente. Com um stub que devolve undefined, essas ~20 ferramentas somem da
 * requisicao e o eval mede quais integracoes estao no .env desta maquina em
 * vez de medir o modelo — que foi exatamente o erro da primeira rodada.
 *
 * Seguro porque so chamamos onModuleInit(): nenhum execute() roda, entao
 * nenhuma credencial falsa chega a uma API de verdade.
 */
const stub: unknown = new Proxy({}, { get: () => () => 'eval-stub' });

function montarRegistry(): ToolRegistryService {
  const registry = new ToolRegistryService(stub as unknown as PrismaService);

  const classes = [
    SystemTools,
    AsaasTools,
    GoogleTools,
    SheetsTools,
    HubspotTools,
    InstagramTools,
    MercadopagoTools,
    PagarmeTools,
    PluggyTools,
    StripeTools,
    AlertTools,
    ReportTools,
    UploadTools,
  ];

  for (const Classe of classes) {
    // As dependencias variam por classe; argumentos extras sao ignorados em JS.
    const Construtor = Classe as unknown as new (
      ...args: unknown[]
    ) => { onModuleInit(): void };
    new Construtor(registry, stub, stub, stub, stub, stub).onModuleInit();
  }

  return registry;
}

/** Le o system prompt REAL — um prompt duplicado aqui avaliaria outra coisa. */
function systemPromptReal(): string {
  const ai = new AiService(
    { get: () => undefined } as unknown as ConfigService,
    stub as unknown as ToolRegistryService,
    stub as unknown as ModelRouterService,
    stub as unknown as AiUsageService,
  );
  return (ai as unknown as { systemPrompt: string })['systemPrompt'];
}

interface Resultado {
  modelo: string;
  acertos: number;
  divergencias: { pedido: string; escolheu: string; esperado: string[] }[];
  tokensEntrada: number;
  tokensSaida: number;
}

async function avaliar(
  client: Anthropic,
  modelo: string,
  tools: Anthropic.Tool[],
  system: string,
): Promise<Resultado> {
  // Reusa o roteador de producao: valida a homologacao do modelo e devolve os
  // mesmos parametros que a rota `chat` usaria de verdade.
  const router = new ModelRouterService({
    get: (chave: string) =>
      chave === 'KATALLI_MODELO_PRINCIPAL' ? modelo : undefined,
  } as unknown as ConfigService);
  router.onModuleInit();
  const perfil = router.resolver('chat');

  const resultado: Resultado = {
    modelo,
    acertos: 0,
    divergencias: [],
    tokensEntrada: 0,
    tokensSaida: 0,
  };

  for (const caso of CASOS) {
    const resposta = await client.messages.create({
      model: perfil.model,
      max_tokens: perfil.maxTokens,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: caso.pedido }],
      tools,
      ...(perfil.outputConfig ? { output_config: perfil.outputConfig } : {}),
    });

    const u = resposta.usage;
    resultado.tokensEntrada +=
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    resultado.tokensSaida += u.output_tokens ?? 0;

    const escolhida = resposta.content.find((b) => b.type === 'tool_use');
    const nome = escolhida ? escolhida.name : '(nenhuma)';

    // Em pedido de escrita, descrever a acao em texto antes de confirmar e o
    // comportamento pedido pelo system prompt — conta como acerto. Chamar uma
    // ferramenta de escrita ERRADA continua sendo falha.
    const acertou = escolhida
      ? caso.esperado.includes(escolhida.name)
      : caso.esperado.length === 0 || caso.escrita === true;

    if (acertou) {
      resultado.acertos++;
    } else {
      resultado.divergencias.push({
        pedido: caso.pedido,
        escolheu: nome,
        esperado: caso.esperado.length ? caso.esperado : ['(nenhuma)'],
      });
    }

    process.stdout.write(acertou ? '.' : 'X');
  }

  process.stdout.write('\n');
  return resultado;
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY ausente no .env');
  }

  const modelos =
    process.argv.slice(2).length > 0
      ? process.argv.slice(2)
      : ['claude-opus-4-8', 'claude-sonnet-5'];

  const registry = montarRegistry();
  const tools = registry.getDefinitions('owner');
  const system = systemPromptReal();

  console.log(
    `\nFerramentas: ${tools.length} | Casos: ${CASOS.length} | Modelos: ${modelos.join(', ')}\n`,
  );

  const client = new Anthropic({ apiKey });
  const resultados: Resultado[] = [];

  for (const modelo of modelos) {
    process.stdout.write(`${modelo.padEnd(20)} `);
    resultados.push(await avaliar(client, modelo, tools, system));
  }

  console.log('\n=== ACERTO NA ESCOLHA DE FERRAMENTA ===\n');
  for (const r of resultados) {
    const pct = ((r.acertos / CASOS.length) * 100).toFixed(0);
    console.log(
      `${r.modelo.padEnd(20)} ${String(r.acertos).padStart(2)}/${CASOS.length}  ${pct.padStart(3)}%   ` +
        `entrada=${r.tokensEntrada} saida=${r.tokensSaida}`,
    );
  }

  for (const r of resultados) {
    if (r.divergencias.length === 0) continue;
    console.log(`\n--- Divergencias: ${r.modelo} ---`);
    for (const d of r.divergencias) {
      console.log(`  "${d.pedido}"`);
      console.log(
        `    escolheu: ${d.escolheu}  |  esperado: ${d.esperado.join(' ou ')}`,
      );
    }
  }

  console.log(
    '\nLeia as divergencias antes de olhar a porcentagem: uma escolha ' +
      'defensavel que eu nao previ deve virar caso novo, nao motivo para ' +
      'rejeitar o modelo.\n',
  );
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
