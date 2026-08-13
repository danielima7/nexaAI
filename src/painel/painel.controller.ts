import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PainelService } from './painel.service';
import { ChatAuthService } from '../chat/chat-auth.service';
import { desenhar, porExtenso } from './grafico-svg';

/**
 * Aba Painel: os graficos que o cliente pediu no chat, prontos para olhar.
 *
 * A pagina e uma casca; os cards chegam por `GET /painel/dados`. Assim a tela
 * aparece na hora e cada grafico entra conforme a planilha responde — uma
 * unica planilha lenta nao segura o resto.
 *
 * Reaproveita o token de sessao do Chat Web, igual a tela de integracoes:
 * mesma conta, mesma organizacao, sem segundo login.
 */
@Controller('painel')
export class PainelController {
  constructor(
    private readonly painel: PainelService,
    private readonly auth: ChatAuthService,
  ) {}

  /** Exige sessao valida e devolve a organizacao dela. */
  private exigirSessao(authorization?: string): string {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;

    const sessao = this.auth.validarToken(token);
    if (!sessao) {
      throw new HttpException(
        'Sessao invalida ou expirada.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return sessao.organizationId;
  }

  /**
   * Cards ja renderizados em SVG.
   *
   * O desenho sai do servidor, e nao do navegador, porque o dado ja esta aqui:
   * mandar pontos crus obrigaria o cliente a rodar JavaScript de plotagem em
   * celular fraco para chegar no mesmo resultado.
   */
  @Get('dados')
  async dados(@Headers('authorization') authorization?: string) {
    const organizationId = this.exigirSessao(authorization);
    const cards = await this.painel.montarPainel(organizationId);

    return {
      cards: cards.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        tipo: c.tipo,
        erro: c.erro,
        aviso: c.aviso,
        svg: c.erro ? undefined : desenhar(c),
        // Total sempre acompanha o grafico: e o numero que o dono da PME
        // procura primeiro, e ler altura de barra nao substitui ver o valor.
        total: c.erro
          ? undefined
          : porExtenso(c.pontos.reduce((s, p) => s + p.valor, 0)),
        pontos: c.pontos.length,
        eixoTemporal: c.eixoTemporal,
        linhasLidas: c.linhasLidas,
        linhasIgnoradas: c.linhasIgnoradas,
      })),
    };
  }

  @Get()
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(PainelController.HTML.replace('__LOGO__', PainelController.LOGO));
  }

  /**
   * Simbolo da marca. O id do gradiente e proprio desta tela: dois
   * `linearGradient` com o mesmo id no documento tornariam o SVG ambiguo.
   */
  private static readonly LOGO = `<svg viewBox="0 0 210 128" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="katalliGradPainel" x1="0" y1="0.5" x2="1" y2="0.35">
      <stop offset="0%" stop-color="#1d4ed8"/><stop offset="38%" stop-color="#0ea5e9"/>
      <stop offset="62%" stop-color="#10b981"/><stop offset="100%" stop-color="#84cc16"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#katalliGradPainel)" stroke-width="21" stroke-linecap="square">
    <path d="M105,64 C105,36 84,20 62,20 C36,20 16,39 16,64 C16,89 36,108 62,108 C84,108 105,92 105,64 C105,36 126,20 148,20 C174,20 194,39 194,64 C194,89 174,108 148,108"/>
    <path d="M119,52 L186,124"/>
  </g>
</svg>`;

  private static readonly HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Katalli — Painel</title>
<style>
  /* Mesma paleta da landing, do chat e das integracoes. */
  :root {
    --breu:#080b14; --painel:#0f1729; --painel-alto:#151f36;
    --borda:#1e2a44; --borda-forte:#2c3b5c;
    --tinta:#e8edf7; --tinta-fraca:#94a3b8; --tinta-tenue:#73839b;
    --azul:#2563eb; --azul-vivo:#3b82f6;
    --ok:#22c55e; --erro:#f87171; --alerta:#fbbf24;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--breu); color:var(--tinta); min-height:100vh;
         -webkit-font-smoothing:antialiased; }
  ::selection { background:var(--azul); color:#fff; }

  header { padding:12px 20px; background:rgba(8,11,20,.88); backdrop-filter:blur(12px);
           border-bottom:1px solid var(--borda); display:flex; align-items:center; gap:12px;
           position:sticky; top:0; z-index:5; }
  header .logo { display:flex; align-items:center; flex:none; text-decoration:none;
                 border-radius:8px; padding:2px; }
  header .logo svg { width:38px; height:auto; display:block; }
  header .logo:hover { filter:brightness(1.15); }
  header .logo:focus-visible { outline:2px solid var(--azul-vivo); outline-offset:3px; }
  header h1 { font-size:17px; margin:0; font-weight:650; letter-spacing:-.01em; }
  header a:not(.logo) { margin-left:auto; color:var(--tinta-fraca); text-decoration:none;
    font-size:13.5px; border:1px solid var(--borda-forte); padding:7px 13px; border-radius:9px;
    transition:border-color .15s, color .15s; }
  header a:not(.logo):hover { border-color:var(--tinta-fraca); color:var(--tinta); }
  header a:focus-visible { outline:2px solid var(--azul-vivo); outline-offset:2px; }

  main { max-width:820px; margin:0 auto; padding:32px 20px 72px; }

  .card { background:var(--painel); border:1px solid var(--borda); border-radius:14px;
          padding:20px; margin-bottom:16px; }
  .card h2 { font-size:16px; margin:0; font-weight:650; letter-spacing:-.01em; }
  .cabeca { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:4px; }
  .total { margin-left:auto; font-size:20px; font-weight:700; letter-spacing:-.02em;
           font-variant-numeric:tabular-nums; }
  .sub { color:var(--tinta-tenue); font-size:12.5px; margin:0 0 14px; }

  .tela { width:100%; overflow-x:auto; }
  .tela svg { width:100%; height:auto; display:block; min-width:340px; }
  .barra { fill:var(--azul); }
  .linha { fill:none; stroke:var(--azul-vivo); stroke-width:2.5; stroke-linejoin:round; }
  .area { fill:rgba(37,99,235,.16); stroke:none; }
  .ponto { fill:var(--azul-vivo); }
  .base { stroke:var(--borda-forte); stroke-width:1; }
  .grade { stroke:var(--borda); stroke-width:1; stroke-dasharray:3 4; }
  .eixo { fill:var(--tinta-tenue); font-size:11px;
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }

  /* Aviso de linha descartada: e informacao, nao decoracao. Um grafico que
     ignorou 300 de 500 linhas em silencio e um grafico mentiroso. */
  .ignoradas { margin:12px 0 0; font-size:12.5px; color:var(--alerta);
               background:rgba(251,191,36,.08); border:1px solid rgba(251,191,36,.22);
               border-radius:9px; padding:9px 12px; line-height:1.5; }
  .falha { margin:8px 0 0; font-size:13.5px; color:var(--erro); line-height:1.6; }

  .vazio { text-align:center; padding:56px 24px; }
  .vazio h2 { font-size:19px; margin:0 0 10px; font-weight:650; }
  .vazio p { color:var(--tinta-fraca); font-size:14.5px; line-height:1.7; margin:0 auto 8px;
             max-width:460px; }
  .exemplo { display:inline-block; margin-top:14px; background:var(--painel-alto);
             border:1px solid var(--borda-forte); border-radius:10px; padding:12px 16px;
             color:var(--tinta); font-size:14px; line-height:1.6; text-align:left; }
  .vazio a { color:var(--azul-vivo); }

  #carregando, #semSessao { text-align:center; color:var(--tinta-fraca); padding:70px 20px; }
  #semSessao a { color:var(--azul-vivo); }
  .oculto { display:none !important; }

  .legais { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 18px;
            padding:8px 16px 0; max-width:820px; margin:0 auto; }
  .legais a { color:var(--tinta-tenue); font-size:12.5px; text-decoration:none; }
  .legais a:hover { color:var(--tinta-fraca); text-decoration:underline; }
  .legais a:focus-visible { outline:2px solid var(--azul-vivo); outline-offset:2px; border-radius:3px; }

  @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }
  @media (max-width:560px) { main { padding-top:24px; } .total { margin-left:0; } }
</style></head>
<body>
  <header>
    <a class="logo" href="/chat" title="Ir para a tela principal" aria-label="Katalli — tela principal">__LOGO__</a>
    <h1>Painel</h1>
    <a href="/chat">Voltar ao chat</a>
  </header>

  <main>
    <div id="carregando">Carregando seus gráficos...</div>

    <div id="semSessao" class="oculto">
      Sua sessão expirou. <a href="/chat">Entre novamente</a> para ver o painel.
    </div>

    <div id="vazio" class="vazio oculto">
      <h2>Seu painel ainda está vazio</h2>
      <p>Os gráficos aqui são criados pela conversa. Peça no chat o que você
         quer acompanhar e ele aparece nesta aba, atualizando sozinho conforme
         a sua planilha muda.</p>
      <div class="exemplo">
        “Quero acompanhar minhas vendas por mês da planilha de vendas”
      </div>
      <p style="margin-top:18px"><a href="/chat">Ir para o chat</a></p>
    </div>

    <div id="cards"></div>
  </main>

  <nav class="legais" aria-label="Documentos institucionais">
    <a href="/privacidade">Privacidade</a>
    <a href="/termos">Termos</a>
    <a href="/seguranca">Segurança</a>
    <a href="/acessibilidade">Acessibilidade</a>
  </nav>

<script>
  const token = localStorage.getItem('katalli_token');
  const carregando = document.getElementById('carregando');
  const semSessao = document.getElementById('semSessao');
  const vazio = document.getElementById('vazio');
  const cards = document.getElementById('cards');

  function semAcesso() {
    carregando.classList.add('oculto');
    semSessao.classList.remove('oculto');
  }

  function elemento(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto) el.textContent = texto;
    return el;
  }

  function montarCard(c) {
    const card = elemento('div', 'card');

    const cabeca = elemento('div', 'cabeca');
    cabeca.appendChild(elemento('h2', null, c.titulo));
    if (c.total !== undefined) {
      cabeca.appendChild(elemento('div', 'total', c.total));
    }
    card.appendChild(cabeca);

    if (c.erro) {
      card.appendChild(elemento('p', 'falha', c.erro));
      return card;
    }

    // "Cliente, Gestor, Operador" nao sao periodos. A palavra vem do tipo do
    // eixo, senao a legenda mente sobre o que o grafico mostra.
    const unidade = c.eixoTemporal
      ? (c.pontos === 1 ? 'período' : 'períodos')
      : (c.pontos === 1 ? 'categoria' : 'categorias');

    const lidas = c.linhasLidas === 1 ? '1 linha lida' : c.linhasLidas + ' linhas lidas';

    card.appendChild(
      elemento('p', 'sub', c.pontos + ' ' + unidade + ' · ' + lidas)
    );

    const tela = elemento('div', 'tela');
    // O SVG vem do servidor, com todo texto de planilha ja escapado la.
    tela.innerHTML = c.svg;
    card.appendChild(tela);

    // Ressalva de card que FUNCIONA mas tem limitacao (serie recem-comecada,
    // CRM maior que a leitura). Diferente de erro: o grafico esta ali.
    if (c.aviso) {
      card.appendChild(elemento('p', 'ignoradas', c.aviso));
    }

    if (c.linhasIgnoradas > 0) {
      card.appendChild(elemento('p', 'ignoradas',
        c.linhasIgnoradas + ' de ' + c.linhasLidas +
        ' linhas foram ignoradas por não terem número na coluna de valor. ' +
        'Confira a planilha se esse número parecer alto.'));
    }

    return card;
  }

  async function carregar() {
    if (!token) { semAcesso(); return; }

    try {
      const r = await fetch('/painel/dados', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (r.status === 401) { semAcesso(); return; }
      if (!r.ok) throw new Error('falha');

      const dados = await r.json();
      carregando.classList.add('oculto');

      if (!dados.cards || dados.cards.length === 0) {
        vazio.classList.remove('oculto');
        return;
      }

      dados.cards.forEach(function (c) { cards.appendChild(montarCard(c)); });
    } catch (e) {
      carregando.textContent =
        'Não consegui carregar o painel agora. Tente recarregar a página.';
    }
  }

  carregar();
</script>
</body></html>`;
}
