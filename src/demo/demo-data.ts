/**
 * Dados ficticios do modo demonstracao.
 *
 * COMO FUNCIONA: quando a organizacao esta marcada como `demo`, o
 * ToolRegistryService devolve estas respostas em vez de chamar a API real.
 * Tudo o mais continua acontecendo de verdade — a IA escolhe a ferramenta, a
 * execucao entra no OperationLog, escrita pede confirmacao. So a resposta da
 * integracao e inventada.
 *
 * Isso permite apresentar o produto sem credencial nenhuma e sem expor dados
 * de ninguem, mostrando o fluxo real em vez de uma encenacao.
 *
 * A empresa ficticia e uma auto eletrica de porte pequeno — proxima do publico
 * que o Katalli atende, com numeros plausiveis. Numeros redondos demais ou
 * grandes demais fazem a demonstracao parecer falsa.
 */

/** Nome da empresa ficticia, usado em varias respostas. */
export const EMPRESA_DEMO = 'Auto Eletrica Silva';

/** Datas relativas para o dado nao "envelhecer" entre demonstracoes. */
function dia(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('pt-BR');
}

function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Respostas por ferramenta. A chave e o nome exato registrado no ToolRegistry.
 * Ferramenta sem entrada aqui responde que a integracao nao esta conectada —
 * o mesmo que aconteceria de verdade.
 */
export const RESPOSTAS_DEMO: Record<string, () => string> = {
  // ---------- Financeiro (Asaas) ----------
  asaas_saldo: () => `Saldo disponivel: ${reais(18470.35)}.`,

  asaas_cobrancas_vencidas: () =>
    [
      'Cobrancas vencidas (3):',
      `- ${reais(890)} — venceu ${dia(-18)} — Transportadora Lima (OVERDUE)`,
      `- ${reais(1250)} — venceu ${dia(-9)} — Mecanica Central (OVERDUE)`,
      `- ${reais(430)} — venceu ${dia(-4)} — Jose Carlos Ribeiro (OVERDUE)`,
    ].join('\n'),

  asaas_cobrancas_a_vencer: () =>
    [
      'Cobrancas a vencer (4):',
      `- ${reais(1680)} — vence hoje — Frota Azul Locadora`,
      `- ${reais(520)} — vence ${dia(1)} — Marcia Fernandes`,
      `- ${reais(2340)} — vence ${dia(2)} — Transportes Uniao`,
      `- ${reais(750)} — vence ${dia(3)} — Oficina do Pedro`,
    ].join('\n'),

  asaas_buscar_cliente: () =>
    'Cliente encontrado: Transportadora Lima — CNPJ 21.345.678/0001-90 — 2 cobrancas em aberto.',

  asaas_criar_cliente: () =>
    'Cliente cadastrado no Asaas com sucesso. (demonstracao)',

  // ---------- Pagamentos ----------
  stripe_saldo: () => `Saldo no Stripe: ${reais(3210.8)}.`,

  stripe_total_recebido: () =>
    `Total recebido no Stripe nos ultimos 30 dias: ${reais(9840.5)} em 22 pagamentos.`,

  stripe_listar_pagamentos: () =>
    [
      'Pagamentos recentes no Stripe:',
      `- ${reais(450)} — ${dia(0)} — aprovado`,
      `- ${reais(1200)} — ${dia(-1)} — aprovado`,
      `- ${reais(320)} — ${dia(-2)} — aprovado`,
    ].join('\n'),

  mercadopago_total_recebido: () =>
    `Total recebido no Mercado Pago nos ultimos 7 dias: ${reais(4125.9)} em 31 pagamentos.`,

  mercadopago_listar_pagamentos: () =>
    [
      'Pagamentos recentes no Mercado Pago:',
      `- ${reais(180)} — ${dia(0)} — aprovado — Pix`,
      `- ${reais(95)} — ${dia(0)} — aprovado — cartao de credito`,
      `- ${reais(640)} — ${dia(-1)} — aprovado — cartao de credito`,
    ].join('\n'),

  // ---------- Bancos (Open Finance) ----------
  pluggy_saldo_total: () =>
    [
      'Saldo total nas contas conectadas: ' + reais(42893.17),
      `- Conta corrente (Banco do Brasil): ${reais(38150.42)}`,
      `- Conta poupanca: ${reais(4742.75)}`,
    ].join('\n'),

  pluggy_contas: () =>
    [
      'Contas conectadas (2):',
      `- Conta corrente — Banco do Brasil — ${reais(38150.42)}`,
      `- Poupanca — Banco do Brasil — ${reais(4742.75)}`,
    ].join('\n'),

  pluggy_transacoes: () =>
    [
      'Ultimas transacoes:',
      `- ${dia(0)} — ${reais(-1240)} — Fornecedor de pecas`,
      `- ${dia(0)} — ${reais(1680)} — Recebimento Pix`,
      `- ${dia(-1)} — ${reais(-380)} — Energia eletrica`,
      `- ${dia(-2)} — ${reais(2340)} — Recebimento boleto`,
    ].join('\n'),

  // ---------- CRM (HubSpot) ----------
  hubspot_buscar_empresas: () =>
    [
      'Empresas cadastradas (5):',
      '- Transportadora Lima',
      '- Frota Azul Locadora',
      '- Mecanica Central',
      '- Transportes Uniao',
      '- Oficina do Pedro',
    ].join('\n'),

  hubspot_buscar_negocios: () =>
    [
      'Negocios em aberto (3):',
      `- Contrato de manutencao de frota — ${reais(18000)} — em negociacao`,
      `- Instalacao de rastreadores — ${reais(7400)} — proposta enviada`,
      `- Revisao eletrica mensal — ${reais(2900)} — qualificacao`,
    ].join('\n'),

  hubspot_buscar_contatos: () =>
    [
      'Contatos (4):',
      '- Roberto Lima — roberto@translima.com.br',
      '- Ana Paula Souza — anapaula@frotaazul.com.br',
      '- Pedro Henrique — pedro@oficinapedro.com.br',
      '- Marcia Fernandes — marcia.f@email.com',
    ].join('\n'),

  hubspot_criar_empresa: () =>
    'Empresa criada no HubSpot com sucesso. (demonstracao)',
  hubspot_criar_contato: () =>
    'Contato criado no HubSpot com sucesso. (demonstracao)',
  hubspot_criar_negocio: () =>
    'Negocio criado no HubSpot com sucesso. (demonstracao)',

  // ---------- Planilhas e agenda ----------
  planilha_listar: () =>
    [
      'Planilhas encontradas (3):',
      '- Faturamento 2026',
      '- Controle de estoque',
      '- Servicos realizados',
    ].join('\n'),

  planilha_ler: () =>
    [
      'Planilha "Faturamento 2026", aba Janeiro (5 primeiras linhas):',
      'Data | Cliente | Servico | Valor',
      `${dia(-4)} | Transportadora Lima | Revisao eletrica | ${reais(890)}`,
      `${dia(-3)} | Frota Azul | Instalacao de alarme | ${reais(1680)}`,
      `${dia(-2)} | Mecanica Central | Troca de alternador | ${reais(1250)}`,
      `${dia(-1)} | Oficina do Pedro | Diagnostico | ${reais(320)}`,
    ].join('\n'),

  planilha_adicionar_linha: () =>
    'Linha adicionada na planilha "Faturamento 2026". (demonstracao)',

  google_agenda_proximos_eventos: () =>
    [
      'Proximos compromissos:',
      `- ${dia(0)} 14:00 — Visita tecnica Frota Azul`,
      `- ${dia(1)} 09:30 — Entrega de orcamento Transportes Uniao`,
      `- ${dia(3)} 16:00 — Reuniao com fornecedor de pecas`,
    ].join('\n'),

  gmail_enviar_email: () => 'E-mail enviado com sucesso. (demonstracao)',

  // ---------- Instagram ----------
  instagram_resumo_conta: () =>
    [
      'Instagram @autoeletricasilva',
      'Seguidores: 2.847',
      'Seguindo: 193',
      'Publicacoes: 64',
    ].join('\n'),

  instagram_metricas: () =>
    [
      `Instagram — de ${dia(-7)} a ${dia(0)}:`,
      'Visualizacoes: 8.412',
      'Alcance: 5.937',
      'Contas engajadas: 421',
      'Interacoes: 168',
    ].join('\n'),

  instagram_posts_recentes: () =>
    [
      'Publicacoes recentes (3):',
      `- ${dia(-2)} [IMAGE] Instalacao de som automotivo — 184 curtidas, 12 comentarios`,
      `- ${dia(-5)} [REELS] Diagnostico eletrico em 60 segundos — 743 curtidas, 38 comentarios`,
      `- ${dia(-9)} [IMAGE] Promocao de revisao eletrica — 291 curtidas, 21 comentarios`,
    ].join('\n'),
};

/** Ha resposta ficticia para esta ferramenta? */
export function temRespostaDemo(ferramenta: string): boolean {
  return ferramenta in RESPOSTAS_DEMO;
}

/** Resposta ficticia da ferramenta. */
export function respostaDemo(ferramenta: string): string {
  return RESPOSTAS_DEMO[ferramenta]();
}
