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
    res.send(ConnectionsController.HTML);
  }

  private static readonly HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Kyrius — Integracoes</title>
<style>
  :root { --bg:#0f172a; --panel:#111827; --accent:#7c3aed; --text:#e5e7eb; --muted:#9ca3af; --erro:#f87171; --ok:#34d399; --linha:#1f2937; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
  header { padding:16px 20px; background:var(--panel); border-bottom:1px solid var(--linha); display:flex; align-items:center; gap:10px; }
  header .logo { width:32px; height:32px; border-radius:8px; background:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:700; }
  header h1 { font-size:18px; margin:0; }
  header a { margin-left:auto; color:var(--muted); text-decoration:none; font-size:14px; border:1px solid #374151; padding:6px 12px; border-radius:8px; }
  main { max-width:760px; margin:0 auto; padding:24px 20px 60px; }
  .aviso { background:#0b1220; border:1px solid var(--linha); border-radius:12px; padding:14px 16px; font-size:13px; color:var(--muted); line-height:1.5; margin-bottom:24px; }
  .grupo { margin-bottom:28px; }
  .grupo h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 10px; font-weight:600; }
  .card { background:var(--panel); border:1px solid var(--linha); border-radius:12px; padding:16px; margin-bottom:10px; }
  .topo { display:flex; align-items:center; gap:12px; }
  .topo .nome { font-weight:600; font-size:15px; }
  .selo { font-size:12px; padding:3px 9px; border-radius:20px; border:1px solid var(--linha); color:var(--muted); }
  .selo.on { color:var(--ok); border-color:#065f46; background:#022c22; }
  .acoes { margin-left:auto; display:flex; gap:8px; }
  button { padding:8px 14px; border-radius:8px; border:none; background:var(--accent); color:#fff; font-weight:600; font-size:13px; cursor:pointer; }
  button.secundario { background:none; border:1px solid #374151; color:var(--muted); }
  button:disabled { opacity:.5; cursor:default; }
  .ajuda { color:var(--muted); font-size:13px; line-height:1.5; margin:10px 0 0; }
  .form { margin-top:12px; display:none; gap:8px; }
  .form.aberto { display:flex; }
  .form input { flex:1; padding:10px 12px; border-radius:8px; border:1px solid #374151; background:#0b1220; color:var(--text); font-size:14px; }
  .form input:focus { outline:none; border-color:var(--accent); }
  .msg { font-size:13px; margin-top:10px; min-height:16px; }
  .msg.erro { color:var(--erro); }
  .msg.ok { color:var(--ok); }
  #carregando, #semSessao { text-align:center; color:var(--muted); padding:60px 20px; }
  #semSessao a { color:var(--accent); }
  .oculto { display:none !important; }
</style></head>
<body>
  <header>
    <div class="logo">K</div>
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

<script>
  const token = localStorage.getItem('kyrius_token');
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
      if (!confirm('Desconectar ' + item.nome + '? O Kyrius deixara de acessar esses dados.')) return;
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
