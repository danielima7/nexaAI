import Anthropic from '@anthropic-ai/sdk';
import {
  FERRAMENTA_BUSCA_WEB,
  fontesCitadas,
  podeBuscarNaWeb,
  rodapeDeFontes,
} from './busca-web';

/** Resultado de busca, no formato REAL que a API devolve (medido). */
function resultado(itens: { url: string; title?: string }[] | object) {
  return {
    type: 'web_search_tool_result',
    content: Array.isArray(itens)
      ? itens.map((i) => ({ type: 'web_search_result', ...i }))
      : itens,
  } as unknown as Anthropic.ContentBlock;
}

/** Bloco de texto puro (sem citacoes — e assim que a API responde aqui). */
function texto() {
  return { type: 'text', text: 'resposta' } as unknown as Anthropic.ContentBlock;
}

describe('podeBuscarNaWeb', () => {
  it('libera para o dono da organizacao', () => {
    expect(podeBuscarNaWeb('owner', true)).toBe(true);
    expect(podeBuscarNaWeb(undefined, true)).toBe(true);
  });

  it('NUNCA libera para audiencia publica', () => {
    // O Direct do Instagram fala com desconhecido. Com busca ali, qualquer um
    // gastaria o credito do cliente so mandando mensagens pedindo pesquisa.
    expect(podeBuscarNaWeb('public', true)).toBe(false);
  });

  it('nao oferece quando o modelo nao suporta', () => {
    // Mandar o tipo `_20260209` para um modelo antigo devolve 400 e derruba
    // TODA resposta da rota, nao so a que ia pesquisar.
    expect(podeBuscarNaWeb('owner', false)).toBe(false);
  });
});

describe('FERRAMENTA_BUSCA_WEB', () => {
  it('tem teto de usos por mensagem', () => {
    // Sem teto, uma pergunta ampla pode disparar buscas em sequencia — cada
    // uma cobrada — enquanto a IA refina a consulta sozinha.
    expect(FERRAMENTA_BUSCA_WEB.max_uses).toBe(5);
    expect(FERRAMENTA_BUSCA_WEB.type).toBe('web_search_20260209');
  });
});

describe('fontesCitadas', () => {
  it('extrai as fontes dos blocos de resultado da busca', () => {
    // MEDIDO contra a API: as `citations` do bloco de texto vem null; as
    // paginas ficam no web_search_tool_result. Extrair do lugar errado
    // devolve lista vazia sem erro — foi o primeiro resultado aqui.
    const f = fontesCitadas([
      resultado([{ url: 'https://a.com', title: 'Site A' }]),
      texto(),
      resultado([{ url: 'https://b.com', title: 'Site B' }]),
    ]);

    expect(f).toEqual([
      { titulo: 'Site A', url: 'https://a.com' },
      { titulo: 'Site B', url: 'https://b.com' },
    ]);
  });

  it('nao repete a mesma URL trazida por buscas diferentes', () => {
    const f = fontesCitadas([
      resultado([{ url: 'https://a.com', title: 'Site A' }]),
      resultado([{ url: 'https://a.com', title: 'Site A' }]),
    ]);
    expect(f).toHaveLength(1);
  });

  it('usa a URL quando nao ha titulo', () => {
    expect(fontesCitadas([resultado([{ url: 'https://a.com' }])])[0].titulo).toBe(
      'https://a.com',
    );
  });

  it('nao quebra quando a busca falha', () => {
    // Em erro a API manda `content` como OBJETO, nao lista. Iterar sem
    // conferir derrubaria a resposta inteira por causa de uma busca falha.
    const erro = resultado({ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' });
    expect(() => fontesCitadas([erro])).not.toThrow();
    expect(fontesCitadas([erro])).toEqual([]);
  });

  it('devolve vazio quando a resposta nao veio de busca', () => {
    expect(fontesCitadas([texto()])).toEqual([]);
    expect(fontesCitadas([])).toEqual([]);
  });
});

describe('rodapeDeFontes', () => {
  it('nao acrescenta nada quando nao houve busca', () => {
    // Resposta sobre o financeiro do cliente nao pode ganhar rodape de fonte.
    expect(rodapeDeFontes([texto()])).toBe('');
  });

  it('lista as fontes de forma legivel', () => {
    const r = rodapeDeFontes([resultado([{ url: 'https://a.com', title: 'Site A' }])]);
    expect(r).toContain('Fontes consultadas:');
    expect(r).toContain('https://a.com');
  });

  it('corta em cinco para nao afogar a resposta', () => {
    const muitas = Array.from({ length: 9 }, (_, i) =>
      resultado([{ url: `https://s${i}.com`, title: `S${i}` }]),
    );
    const linhas = rodapeDeFontes(muitas)
      .split('\n')
      .filter((l) => l.startsWith('- '));
    expect(linhas).toHaveLength(5);
  });
});
