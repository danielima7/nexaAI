/**
 * Catalogo das integracoes que o cliente pode conectar sozinho.
 *
 * Duas formas de conexao, e a diferenca importa para a interface:
 *  - `token`: o cliente cola uma chave de API que ele mesmo gera no provedor.
 *  - `oauth`: o cliente e levado a autorizar no proprio provedor e volta.
 *
 * Este catalogo existe para a TELA. A capacidade de cada integracao continua
 * vindo das ferramentas registradas no ToolRegistry — aqui so descrevemos como
 * obter a credencial.
 */
export interface ProvedorConectavel {
  /** Chave usada em `Connection.provider`. */
  id: string;
  nome: string;
  categoria: string;
  tipo: 'token' | 'oauth';
  /** Onde o cliente encontra a credencial (texto curto, para leigo). */
  ajuda: string;
  /** Rota que inicia o fluxo OAuth. A organizacao vai no parametro `org`. */
  rotaOAuth?: string;
  /** Dica de formato, exibida como placeholder. */
  formato?: string;
  /**
   * Perguntas que fazem sentido quando ESTA integracao esta conectada.
   *
   * Existem porque a maior barreira de um produto conversacional nao e a IA
   * errar — e o usuario abrir a tela em branco e nao saber o que pedir. O dono
   * da padaria nao imagina que pode perguntar por inadimplentes.
   */
  sugestoes: string[];
}

export const PROVEDORES: ProvedorConectavel[] = [
  {
    id: 'hubspot',
    sugestoes: ["Quantos negocios estao abertos?", "Lista as empresas cadastradas"],
    nome: 'HubSpot',
    categoria: 'CRM',
    tipo: 'token',
    ajuda:
      'No HubSpot: Configuracoes → Integracoes → Chaves de servico → criar uma chave com acesso a empresas, contatos e negocios.',
    formato: 'pat-na1-...',
  },
  {
    id: 'asaas',
    sugestoes: ["Quem esta inadimplente?", "Quais boletos vencem hoje?"],
    nome: 'Asaas',
    categoria: 'Financeiro',
    tipo: 'token',
    ajuda:
      'No Asaas: Configuracoes → Integracoes → Chave de API. Copie a chave completa.',
    formato: '$aact_...',
  },
  {
    id: 'stripe',
    sugestoes: ["Quanto entrou no Stripe este mes?"],
    nome: 'Stripe',
    categoria: 'Pagamentos',
    tipo: 'token',
    ajuda:
      'No Stripe: Desenvolvedores → Chaves de API → Chave secreta. Use a chave de teste para validar antes.',
    formato: 'sk_live_... ou sk_test_...',
  },
  {
    id: 'mercadopago',
    sugestoes: ["Quanto recebi no Mercado Pago esta semana?"],
    nome: 'Mercado Pago',
    categoria: 'Pagamentos',
    tipo: 'token',
    ajuda:
      'No Mercado Pago: Suas integracoes → selecione a aplicacao → Credenciais de producao → Access Token.',
    formato: 'APP_USR-...',
  },
  {
    id: 'pagarme',
    sugestoes: ["Lista meus ultimos pedidos"],
    nome: 'Pagar.me',
    categoria: 'Pagamentos',
    tipo: 'token',
    ajuda: 'No Pagar.me: Configuracoes → Chaves → Chave secreta.',
    formato: 'sk_...',
  },
  {
    id: 'google',
    sugestoes: ["Lista minhas planilhas", "Quais meus proximos compromissos?"],
    nome: 'Google (Planilhas, Drive e Agenda)',
    categoria: 'Produtividade',
    tipo: 'oauth',
    ajuda:
      'Voce sera levado ao Google para autorizar. Marque todas as permissoes para o Katalli conseguir ler e escrever nas suas planilhas.',
    rotaOAuth: '/google/auth',
  },
  {
    id: 'instagram',
    sugestoes: ["Quantos seguidores eu tenho?", "Como foi meu Instagram nos ultimos 7 dias?"],
    nome: 'Instagram',
    categoria: 'Redes sociais',
    tipo: 'oauth',
    ajuda:
      'Requer conta Business ou Creator vinculada a uma Pagina do Facebook. Voce escolhe a Pagina durante a autorizacao.',
    rotaOAuth: '/instagram/auth',
  },
  {
    id: 'pluggy',
    sugestoes: ["Qual meu saldo bancario?", "Mostra as ultimas transacoes"],
    nome: 'Contas bancarias (Open Finance)',
    categoria: 'Bancos',
    tipo: 'oauth',
    ajuda:
      'Voce escolhe o banco e autoriza o acesso de leitura pelo Open Finance, dentro do ambiente do proprio banco.',
    rotaOAuth: '/pluggy/connect',
  },
];

/** Provedor pelo id, ou `undefined` se nao for conectavel pela tela. */
export function acharProvedor(id: string): ProvedorConectavel | undefined {
  return PROVEDORES.find((p) => p.id === id);
}

/** Sugestoes exibidas quando a organizacao ainda nao conectou nada. */
export const SUGESTOES_SEM_INTEGRACAO = [
  'O que voce consegue fazer?',
  'Como conecto minhas contas?',
  'Quero receber um resumo diario',
];

/**
 * Monta ate `limite` perguntas sugeridas para as integracoes conectadas.
 *
 * Pega uma pergunta de cada provedor antes de repetir — assim quem conectou
 * Asaas e Instagram ve uma de cada, em vez de duas do mesmo.
 */
export function sugestoesPara(
  conectados: string[],
  limite = 4,
): string[] {
  const provedores = PROVEDORES.filter((p) => conectados.includes(p.id));
  if (provedores.length === 0) return SUGESTOES_SEM_INTEGRACAO;

  const escolhidas: string[] = [];
  for (let rodada = 0; escolhidas.length < limite; rodada++) {
    const antes = escolhidas.length;
    for (const p of provedores) {
      if (escolhidas.length >= limite) break;
      if (p.sugestoes[rodada]) escolhidas.push(p.sugestoes[rodada]);
    }
    // Nenhum provedor tinha pergunta nesta rodada: acabaram as opcoes.
    if (escolhidas.length === antes) break;
  }

  return escolhidas;
}
