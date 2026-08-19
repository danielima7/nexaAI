import Anthropic from '@anthropic-ai/sdk';

/**
 * Busca na web como ferramenta de SERVIDOR da Anthropic.
 *
 * POR QUE EXISTE: sem isto, qualquer pergunta que dependa de informacao de
 * fora — "quais advocacias existem em Niteroi", "qual o CNPJ dessa empresa" —
 * era recusada, porque o Katalli so enxerga as ferramentas das integracoes
 * conectadas e o system prompt proibe inventar dado.
 *
 * A proibicao continua valendo e e o ponto principal: a alternativa NAO e
 * deixar a IA responder de memoria. Uma lista de escritorios gerada do treino
 * parece correta e pode ser inteiramente falsa — endereco errado, telefone de
 * outra empresa, negocio que fechou. Com a busca, cada afirmacao vem de uma
 * pagina real e a fonte e devolvida ao cliente para conferir.
 *
 * Roda no servidor da Anthropic: nao ha raspagem, nao ha chave nova, nao ha
 * navegador para manter.
 */

/**
 * Teto de buscas por mensagem.
 *
 * Cada busca e cobrada a parte, e os resultados voltam como texto que entra
 * nos tokens da conversa — uma pergunta ampla pode disparar varias. Cinco
 * atende "compare X e Y em tres fontes" e ainda barra o caso em que a IA fica
 * refinando a consulta indefinidamente com o cliente pagando.
 */
const MAX_BUSCAS_POR_MENSAGEM = 5;

/**
 * Definicao da ferramenta.
 *
 * A variante `_20260209` (filtragem dinamica) exige geracao 4.6+ — quem
 * decide se pode usa-la e o ModelRouterService, pelo registro de capacidades.
 */
export const FERRAMENTA_BUSCA_WEB = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: MAX_BUSCAS_POR_MENSAGEM,
  // Sem `allowed_domains`: restringir a lista fixa de sites transformaria uma
  // busca aberta num diretorio nosso, e o que o cliente pergunta e imprevisivel.
} as const;

/**
 * A busca pode ser oferecida nesta conversa?
 *
 * NUNCA para audiencia `public`. O atendimento do Direct do Instagram fala com
 * um desconhecido, e ali a busca seria um canal para alguem de fora gastar o
 * credito do cliente — basta mandar mensagens pedindo pesquisas. O publico
 * tambem nao enxerga nenhuma outra ferramenta, pelo mesmo motivo.
 */
export function podeBuscarNaWeb(
  audiencia: string | undefined,
  modeloAceita: boolean,
): boolean {
  return modeloAceita && audiencia !== 'public';
}

/**
 * Paginas consultadas na resposta, sem repetir.
 *
 * VEM DOS BLOCOS `web_search_tool_result`, e nao das `citations` do texto —
 * medido contra a API: com esta ferramenta as citacoes do bloco de texto
 * chegam `null`, e as paginas ficam no resultado da busca. Extrair do lugar
 * errado devolve lista vazia sem erro nenhum, que foi o primeiro resultado
 * aqui.
 *
 * Devolvidas ao cliente de proposito. Uma lista de empresas sem link e
 * indistinguivel de uma lista inventada — e distinguir as duas coisas e todo o
 * motivo de a busca existir aqui. Com o link, ele confere em um clique.
 */
export function fontesCitadas(
  blocos: Anthropic.ContentBlock[],
): { titulo: string; url: string }[] {
  const vistas = new Set<string>();
  const fontes: { titulo: string; url: string }[] = [];

  for (const bloco of blocos) {
    if (bloco.type !== 'web_search_tool_result') continue;

    // Em erro, `content` vem como OBJETO ({error_code}), nao lista — iterar
    // sem conferir quebraria a resposta inteira por causa de uma busca falha.
    const conteudo = (bloco as { content?: unknown }).content;
    if (!Array.isArray(conteudo)) continue;

    for (const item of conteudo) {
      const r = item as { url?: string; title?: string };
      if (!r?.url || vistas.has(r.url)) continue;
      vistas.add(r.url);
      fontes.push({ titulo: r.title?.trim() || r.url, url: r.url });
    }
  }

  return fontes;
}

/** Rodape com as fontes, ou vazio quando a resposta nao veio de busca. */
export function rodapeDeFontes(blocos: Anthropic.ContentBlock[]): string {
  const fontes = fontesCitadas(blocos);
  if (fontes.length === 0) return '';

  // Teto de 5: a resposta e lida no chat e no WhatsApp, e uma parede de links
  // afoga o conteudo. As primeiras sao as mais usadas na redacao.
  const lista = fontes
    .slice(0, 5)
    .map((f) => `- ${f.titulo}: ${f.url}`)
    .join('\n');

  // "Consultadas", e nao "citadas": sao as paginas que a busca trouxe, e nem
  // toda ela necessariamente sustenta uma frase especifica da resposta.
  // Chamar de "fonte" o que talvez nao tenha sido usado seria exagerar a
  // garantia — justamente o oposto do que esta funcionalidade existe para dar.
  return `\n\nFontes consultadas:\n${lista}`;
}
