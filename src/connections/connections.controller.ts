import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConnectionsService } from './connections.service';
import { ChatAuthService } from '../chat/chat-auth.service';
import { PROVEDORES, acharProvedor } from './provider-catalog';

/**
 * Tela de integracoes: onde o cliente conecta as proprias contas.
 *
 * POR QUE ESTA TELA EXISTE: sem ela, a unica forma de conectar HubSpot, Stripe
 * ou Asaas seria o cliente COLAR A CHAVE DE API NO CHAT — e ali ela ficaria no
 * historico da conversa, na tabela `Message` e nos logs, contornando a
 * criptografia de `Connection.credentials`. Segredo nao passa por conversa.
 *
 * A pagina reaproveita o token de sessao do Chat Web: mesma conta, mesma
 * organizacao, sem segundo login.
 */
@Controller('integracoes')
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
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
   * Catalogo + quais estao conectadas.
   * NUNCA devolve a credencial em si — apenas se existe.
   */
  @Get('status')
  async status(@Headers('authorization') authorization?: string) {
    const organizationId = this.exigirSessao(authorization);
    const conectados = new Set(
      await this.connections.listProviders(organizationId),
    );

    return {
      organizationId,
      integracoes: PROVEDORES.map((p) => ({
        id: p.id,
        nome: p.nome,
        categoria: p.categoria,
        tipo: p.tipo,
        ajuda: p.ajuda,
        formato: p.formato ?? null,
        conectado: conectados.has(p.id),
        // A organizacao viaja no link do OAuth, como nos fluxos ja existentes.
        urlOAuth: p.rotaOAuth ? `${p.rotaOAuth}?org=${organizationId}` : null,
      })),
    };
  }

  /** Salva a credencial de um provedor de token (ja cifrada pelo service). */
  @Post('conectar')
  @HttpCode(HttpStatus.OK)
  async conectar(
    @Body() body: { provider?: string; token?: string },
    @Headers('authorization') authorization?: string,
  ): Promise<{ ok: true }> {
    const organizationId = this.exigirSessao(authorization);

    const provedor = body?.provider ? acharProvedor(body.provider) : undefined;
    if (!provedor) {
      throw new HttpException('Integracao desconhecida.', HttpStatus.BAD_REQUEST);
    }
    if (provedor.tipo !== 'token') {
      throw new HttpException(
        'Esta integracao e conectada por autorizacao, nao por chave.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const token = body?.token?.trim();
    if (!token) {
      throw new HttpException('Informe a chave.', HttpStatus.BAD_REQUEST);
    }

    await this.connections.set(organizationId, provedor.id, { token });
    return { ok: true };
  }

  /** Remove a conexao (o cliente pode revogar quando quiser). */
  @Delete(':provider')
  @HttpCode(HttpStatus.OK)
  async desconectar(
    @Param('provider') provider: string,
    @Headers('authorization') authorization?: string,
  ): Promise<{ ok: true }> {
    const organizationId = this.exigirSessao(authorization);
    if (!acharProvedor(provider)) {
      throw new HttpException('Integracao desconhecida.', HttpStatus.BAD_REQUEST);
    }
    await this.connections.remover(organizationId, provider);
    return { ok: true };
  }

  /** Pagina de integracoes. */
  @Get()
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      ConnectionsController.HTML.replace(
        '__LOGO__',
        ConnectionsController.LOGO,
      ),
    );
  }

  /**
   * Simbolo da marca — mesmo SVG da landing e do chat, embutido para a pagina
   * nao depender de arquivo externo. O id do gradiente e proprio desta tela:
   * dois `linearGradient` com o mesmo id no documento tornariam o SVG
   * ambiguo para o navegador.
   */
  private static readonly LOGO = `<svg viewBox="0 0 210 128" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="katalliGradIntegra" x1="0" y1="0.5" x2="1" y2="0.35">
      <stop offset="0%" stop-color="#1d4ed8"/><stop offset="38%" stop-color="#0ea5e9"/>
      <stop offset="62%" stop-color="#10b981"/><stop offset="100%" stop-color="#84cc16"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#katalliGradIntegra)" stroke-width="21" stroke-linecap="square">
    <path d="M105,64 C105,36 84,20 62,20 C36,20 16,39 16,64 C16,89 36,108 62,108 C84,108 105,92 105,64 C105,36 126,20 148,20 C174,20 194,39 194,64 C194,89 174,108 148,108"/>
    <path d="M119,52 L186,124"/>
  </g>
</svg>`;

  private static readonly HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Katalli — Integracoes</title>
<style>
  /* Mesma paleta da landing e do chat. */
  :root {
    --breu:#080b14; --painel:#0f1729; --painel-alto:#151f36;
    --borda:#1e2a44; --borda-forte:#2c3b5c;
    --tinta:#e8edf7; --tinta-fraca:#94a3b8; --tinta-tenue:#73839b;
    --azul:#2563eb; --azul-vivo:#3b82f6;
    --ok:#22c55e; --erro:#f87171;
    /* Alias mantidos: o JS e o CSS antigo referenciam estes nomes. */
    --accent:#2563eb; --muted:#94a3b8; --text:#e8edf7; --linha:#1e2a44;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--breu); color:var(--tinta); min-height:100vh;
         -webkit-font-smoothing:antialiased; }
  ::selection { background:var(--azul); color:#fff; }

  header { padding:12px 20px; background:rgba(8,11,20,.88); backdrop-filter:blur(12px);
           border-bottom:1px solid var(--borda); display:flex; align-items:center; gap:12px;
           position:sticky; top:0; z-index:5; }
  /* Sem largura fixa: o simbolo e largo e um container quadrado o espremeria. */
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

  main { max-width:780px; margin:0 auto; padding:32px 20px 72px; }
  .aviso { background:var(--painel); border:1px solid var(--borda); border-left:3px solid var(--azul);
           border-radius:0 12px 12px 0; padding:15px 18px; font-size:13.5px; color:var(--tinta-fraca);
           line-height:1.6; margin-bottom:30px; }
  .grupo { margin-bottom:34px; }
  .grupo h2 { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;
              text-transform:uppercase; letter-spacing:.12em; color:var(--azul-vivo);
              margin:0 0 12px; font-weight:600; }

  .card { background:var(--painel); border:1px solid var(--borda); border-radius:14px;
          padding:18px; margin-bottom:11px; transition:border-color .15s; }
  .card:hover { border-color:var(--borda-forte); }
  .topo { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .topo .nome { font-weight:650; font-size:15.5px; letter-spacing:-.01em; }
  /* O estado tambem aparece na cor E no texto: quem nao distingue verde de
     cinza precisa conseguir ler que esta conectado. */
  .selo { font-size:12px; padding:4px 10px; border-radius:99px; border:1px solid var(--borda-forte);
          color:var(--tinta-fraca); white-space:nowrap; }
  .selo.on { color:var(--ok); border-color:#166534; background:rgba(34,197,94,.12); }
  .acoes { margin-left:auto; display:flex; gap:8px; }

  button { padding:9px 16px; border-radius:9px; border:none; background:var(--azul); color:#fff;
           font-weight:600; font-size:13.5px; cursor:pointer; transition:background .15s; }
  button:hover:not(:disabled) { background:var(--azul-vivo); }
  button.secundario { background:none; border:1px solid var(--borda-forte); color:var(--tinta-fraca); }
  button.secundario:hover:not(:disabled) { background:none; border-color:var(--tinta-fraca); color:var(--tinta); }
  button:disabled { opacity:.45; cursor:default; }
  button:focus-visible { outline:2px solid var(--azul-vivo); outline-offset:2px; }

  .ajuda { color:var(--tinta-fraca); font-size:13.5px; line-height:1.6; margin:12px 0 0; }
  .form { margin-top:14px; display:none; gap:9px; }
  .form.aberto { display:flex; }
  .form input { flex:1; padding:11px 14px; border-radius:10px; border:1px solid var(--borda-forte);
                background:var(--painel-alto); color:var(--tinta); font-size:14px;
                transition:border-color .15s, box-shadow .15s; }
  /* Mais claro que o --tinta-tenue usado no chat: aqui o campo fica sobre o
     painel-alto, e o tom do chat cairia para 4.25:1, abaixo do minimo. Este
     da 4.73:1 sem competir com o texto ja digitado. */
  .form input::placeholder { color:#7b8ba3; }
  .form input:focus { outline:none; border-color:var(--azul-vivo); box-shadow:0 0 0 3px rgba(37,99,235,.18); }

  .msg { font-size:13.5px; margin-top:11px; min-height:17px; }
  .msg.erro { color:var(--erro); }
  .msg.ok { color:var(--ok); }
  #carregando, #semSessao { text-align:center; color:var(--tinta-fraca); padding:70px 20px; }
  #semSessao a { color:var(--azul-vivo); }
  .oculto { display:none !important; }

  /* Rodape institucional, igual ao do chat. */
  .legais { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 18px;
            padding:8px 16px 0; max-width:780px; margin:0 auto; }
  .legais a { color:var(--tinta-tenue); font-size:12.5px; text-decoration:none; }
  .legais a:hover { color:var(--tinta-fraca); text-decoration:underline; }
  .legais a:focus-visible { outline:2px solid var(--azul-vivo); outline-offset:2px; border-radius:3px; }

  @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }
  @media (max-width:560px) { .acoes { margin-left:0; width:100%; } main { padding-top:24px; } }
</style></head>
<body>
  <header>
    <a class="logo" href="/chat" title="Ir para a tela principal" aria-label="Katalli — tela principal">__LOGO__</a>
    <h1>Integracoes</h1>
    <a href="/chat">Voltar ao chat</a>
  </header>

  <main>
    <div id="carregando">Carregando suas integracoes...</div>

    <div id="semSessao" class="oculto">
      Sua sessao expirou. <a href="/chat">Entre novamente</a> para gerenciar as integracoes.
    </div>

    <div id="conteudo" class="oculto">
      <div class="aviso">
        Suas chaves sao guardadas <b>criptografadas</b> e usadas apenas para
        atender aos seus pedidos. Nunca envie chaves pelo chat — use esta pagina.
        Voce pode desconectar qualquer integracao quando quiser.
      </div>
      <div id="grupos"></div>
    </div>
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
  const conteudo = document.getElementById('conteudo');
  const grupos = document.getElementById('grupos');

  function semAcesso() {
    carregando.classList.add('oculto');
    conteudo.classList.add('oculto');
    semSessao.classList.remove('oculto');
  }

  async function api(caminho, opcoes) {
    const r = await fetch(caminho, Object.assign({
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + token }
    }, opcoes || {}));
    if (r.status === 401) { semAcesso(); throw new Error('sessao'); }
    return r;
  }

  function cartao(item) {
    const card = document.createElement('div');
    card.className = 'card';

    const topo = document.createElement('div');
    topo.className = 'topo';

    const nome = document.createElement('span');
    nome.className = 'nome';
    nome.textContent = item.nome;

    const selo = document.createElement('span');
    selo.className = 'selo' + (item.conectado ? ' on' : '');
    selo.textContent = item.conectado ? 'Conectado' : 'Nao conectado';

    const acoes = document.createElement('div');
    acoes.className = 'acoes';

    const msg = document.createElement('div');
    msg.className = 'msg';

    if (item.tipo === 'oauth') {
      const botao = document.createElement('button');
      botao.textContent = item.conectado ? 'Reconectar' : 'Conectar';
      botao.onclick = () => { location.href = item.urlOAuth; };
      acoes.appendChild(botao);
    } else {
      const form = document.createElement('form');
      form.className = 'form';

      const campo = document.createElement('input');
      campo.type = 'password';
      campo.placeholder = item.formato || 'Cole a chave aqui';
      campo.autocomplete = 'off';

      const salvar = document.createElement('button');
      salvar.type = 'submit';
      salvar.textContent = 'Salvar';

      form.appendChild(campo);
      form.appendChild(salvar);

      const abrir = document.createElement('button');
      abrir.textContent = item.conectado ? 'Trocar chave' : 'Conectar';
      abrir.onclick = () => {
        form.classList.toggle('aberto');
        if (form.classList.contains('aberto')) campo.focus();
      };
      acoes.appendChild(abrir);

      form.onsubmit = async (e) => {
        e.preventDefault();
        msg.textContent = '';
        msg.className = 'msg';
        salvar.disabled = true;
        try {
          const r = await api('/integracoes/conectar', {
            method:'POST',
            body: JSON.stringify({ provider: item.id, token: campo.value })
          });
          const dados = await r.json().catch(() => ({}));
          if (!r.ok) {
            msg.textContent = dados.message || 'Nao foi possivel salvar.';
            msg.className = 'msg erro';
          } else {
            campo.value = '';
            form.classList.remove('aberto');
            msg.textContent = 'Conectado com sucesso.';
            msg.className = 'msg ok';
            selo.textContent = 'Conectado';
            selo.className = 'selo on';
            abrir.textContent = 'Trocar chave';
            if (!card.querySelector('.desconectar')) acoes.appendChild(botaoDesconectar(item, selo, abrir, acoes, msg));
          }
        } catch (err) {
          if (err.message !== 'sessao') { msg.textContent = 'Erro ao falar com o servidor.'; msg.className = 'msg erro'; }
        } finally {
          salvar.disabled = false;
        }
      };

      card.appendChild(topo);
      const ajuda = document.createElement('p');
      ajuda.className = 'ajuda';
      ajuda.textContent = item.ajuda;
      card.appendChild(ajuda);
      card.appendChild(form);
      card.appendChild(msg);

      topo.appendChild(nome);
      topo.appendChild(selo);
      topo.appendChild(acoes);
      if (item.conectado) acoes.appendChild(botaoDesconectar(item, selo, abrir, acoes, msg));
      return card;
    }

    topo.appendChild(nome);
    topo.appendChild(selo);
    topo.appendChild(acoes);
    card.appendChild(topo);

    const ajuda = document.createElement('p');
    ajuda.className = 'ajuda';
    ajuda.textContent = item.ajuda;
    card.appendChild(ajuda);
    card.appendChild(msg);

    if (item.conectado) acoes.appendChild(botaoDesconectar(item, selo, null, acoes, msg));
    return card;
  }

  function botaoDesconectar(item, selo, abrir, acoes, msg) {
    const botao = document.createElement('button');
    botao.className = 'secundario desconectar';
    botao.textContent = 'Desconectar';
    botao.onclick = async () => {
      if (!confirm('Desconectar ' + item.nome + '? O Katalli deixara de acessar esses dados.')) return;
      botao.disabled = true;
      try {
        const r = await api('/integracoes/' + item.id, { method:'DELETE' });
        if (r.ok) {
          selo.textContent = 'Nao conectado';
          selo.className = 'selo';
          if (abrir) abrir.textContent = 'Conectar';
          botao.remove();
          msg.textContent = 'Desconectado.';
          msg.className = 'msg';
        }
      } catch (err) {
        if (err.message !== 'sessao') { botao.disabled = false; }
      }
    };
    return botao;
  }

  async function carregar() {
    if (!token) return semAcesso();
    try {
      const r = await api('/integracoes/status');
      const dados = await r.json();

      const porCategoria = {};
      for (const item of dados.integracoes) {
        (porCategoria[item.categoria] = porCategoria[item.categoria] || []).push(item);
      }

      for (const categoria of Object.keys(porCategoria)) {
        const grupo = document.createElement('div');
        grupo.className = 'grupo';
        const titulo = document.createElement('h2');
        titulo.textContent = categoria;
        grupo.appendChild(titulo);
        for (const item of porCategoria[categoria]) grupo.appendChild(cartao(item));
        grupos.appendChild(grupo);
      }

      carregando.classList.add('oculto');
      conteudo.classList.remove('oculto');
    } catch (err) {
      if (err.message !== 'sessao') {
        carregando.textContent = 'Nao foi possivel carregar as integracoes.';
      }
    }
  }

  carregar();
</script>
</body></html>`;
}
