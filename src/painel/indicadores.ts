import { TipoGrafico } from './painel.types';

/**
 * Catalogo de indicadores prontos.
 *
 * Planilha exige que a IA descubra o mapeamento, porque cada cliente monta a
 * dele de um jeito. Aqui e o oposto: Instagram e HubSpot tem schema fixo, o
 * mesmo para todo mundo. Entao nao ha nada para inferir — o cliente escolhe um
 * item de uma lista e pronto.
 *
 * Isso tambem torna estes cards mais confiaveis que os de planilha: nao existe
 * "a IA errou a coluna". O unico jeito de dar errado e a integracao cair.
 */

/** De onde o card le os numeros. */
export type FonteIndicador =
  /** Serie gravada pela coleta diaria (tabela Metrica). */
  | 'metrica_historica'
  /** Consulta ao vivo do funil do HubSpot. */
  | 'hubspot_funil';

export interface Indicador {
  /** Id usado pela IA e gravado em PainelCard.fonte + config. */
  id: string;
  /** Titulo padrao do card. O cliente pode pedir outro. */
  titulo: string;
  fonte: FonteIndicador;
  tipo: TipoGrafico;
  /** Conexao necessaria — sem ela, nem oferecemos. */
  provedor: 'instagram' | 'hubspot';
  /** Serie da tabela Metrica, quando `fonte` for historica. */
  chave?: string;
  /** Explicacao curta, usada pela IA ao confirmar com o cliente. */
  descricao: string;
}

/**
 * Todo indicador historico depende da coleta diaria ter rodado.
 *
 * Isso e uma limitacao REAL e precisa ser dita ao cliente na hora de criar: a
 * serie comeca no dia em que a coleta comecou, e o Instagram nao informa
 * quantos seguidores ele tinha mes passado. Prometer um grafico de 12 meses
 * para quem conectou ontem seria mentira.
 */
export const INDICADORES: Indicador[] = [
  {
    id: 'instagram_seguidores',
    titulo: 'Seguidores no Instagram',
    fonte: 'metrica_historica',
    tipo: 'linha',
    provedor: 'instagram',
    chave: 'instagram.seguidores',
    descricao: 'Evolucao do numero de seguidores, dia a dia.',
  },
  {
    id: 'instagram_alcance',
    titulo: 'Alcance no Instagram',
    fonte: 'metrica_historica',
    tipo: 'linha',
    provedor: 'instagram',
    chave: 'instagram.alcance',
    descricao: 'Quantas contas viram o conteudo por dia.',
  },
  {
    id: 'instagram_visualizacoes',
    titulo: 'Visualizacoes no Instagram',
    fonte: 'metrica_historica',
    tipo: 'linha',
    provedor: 'instagram',
    chave: 'instagram.visualizacoes',
    descricao: 'Visualizacoes do conteudo por dia.',
  },
  {
    id: 'instagram_interacoes',
    titulo: 'Interacoes no Instagram',
    fonte: 'metrica_historica',
    tipo: 'linha',
    provedor: 'instagram',
    chave: 'instagram.interacoes',
    descricao: 'Curtidas, comentarios e salvamentos por dia.',
  },
  {
    id: 'hubspot_funil',
    titulo: 'Funil de vendas',
    fonte: 'hubspot_funil',
    tipo: 'barra',
    provedor: 'hubspot',
    descricao: 'Valor em negociacao em cada estagio do funil, agora.',
  },
  {
    id: 'hubspot_funil_evolucao',
    titulo: 'Valor do funil ao longo do tempo',
    fonte: 'metrica_historica',
    tipo: 'linha',
    provedor: 'hubspot',
    chave: 'hubspot.funil.valor',
    descricao: 'Como o valor total em negociacao evoluiu, dia a dia.',
  },
  {
    id: 'hubspot_negocios',
    titulo: 'Negocios em aberto',
    fonte: 'metrica_historica',
    tipo: 'linha',
    provedor: 'hubspot',
    chave: 'hubspot.negocios',
    descricao: 'Quantidade de negocios no funil, dia a dia.',
  },
];

export function acharIndicador(id: string): Indicador | undefined {
  return INDICADORES.find((i) => i.id === String(id ?? '').trim());
}
