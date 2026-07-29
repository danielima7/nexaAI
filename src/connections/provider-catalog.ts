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
}

export const PROVEDORES: ProvedorConectavel[] = [
  {
    id: 'hubspot',
    nome: 'HubSpot',
    categoria: 'CRM',
    tipo: 'token',
    ajuda:
      'No HubSpot: Configuracoes → Integracoes → Chaves de servico → criar uma chave com acesso a empresas, contatos e negocios.',
    formato: 'pat-na1-...',
  },
  {
    id: 'asaas',
    nome: 'Asaas',
    categoria: 'Financeiro',
    tipo: 'token',
    ajuda:
      'No Asaas: Configuracoes → Integracoes → Chave de API. Copie a chave completa.',
    formato: '$aact_...',
  },
  {
    id: 'stripe',
    nome: 'Stripe',
    categoria: 'Pagamentos',
    tipo: 'token',
    ajuda:
      'No Stripe: Desenvolvedores → Chaves de API → Chave secreta. Use a chave de teste para validar antes.',
    formato: 'sk_live_... ou sk_test_...',
  },
  {
    id: 'mercadopago',
    nome: 'Mercado Pago',
    categoria: 'Pagamentos',
    tipo: 'token',
    ajuda:
      'No Mercado Pago: Suas integracoes → selecione a aplicacao → Credenciais de producao → Access Token.',
    formato: 'APP_USR-...',
  },
  {
    id: 'pagarme',
    nome: 'Pagar.me',
    categoria: 'Pagamentos',
    tipo: 'token',
    ajuda: 'No Pagar.me: Configuracoes → Chaves → Chave secreta.',
    formato: 'sk_...',
  },
  {
    id: 'google',
    nome: 'Google (Planilhas, Drive e Agenda)',
    categoria: 'Produtividade',
    tipo: 'oauth',
    ajuda:
      'Voce sera levado ao Google para autorizar. Marque todas as permissoes para o Kyrius conseguir ler e escrever nas suas planilhas.',
    rotaOAuth: '/google/auth',
  },
  {
    id: 'instagram',
    nome: 'Instagram',
    categoria: 'Redes sociais',
    tipo: 'oauth',
    ajuda:
      'Requer conta Business ou Creator vinculada a uma Pagina do Facebook. Voce escolhe a Pagina durante a autorizacao.',
    rotaOAuth: '/instagram/auth',
  },
  {
    id: 'pluggy',
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
