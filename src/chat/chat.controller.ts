import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Headers,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../ai/ai.service';
import { ConversationMemoryService } from '../ai/conversation-memory.service';
import { TenantService } from '../tenant/tenant.service';
import { ChatAuthService } from './chat-auth.service';

/**
 * Chat Web do Kyrius: uma pagina simples servida pelo backend + um endpoint
 * que reaproveita a mesma IA, ferramentas, memoria e multi-tenant do WhatsApp.
 *
 * AUTENTICADO: o acesso exige a senha da instalacao (`CHAT_ACCESS_PASSWORD`).
 * A organizacao vem do TOKEN DE SESSAO assinado pelo servidor — antes vinha de
 * um `sessionId` inventado pelo navegador, o que deixava qualquer visitante
 * criar um tenant e conversar com a IA.
 *
 * O `sessionId` continua existindo, mas apenas como chave do historico de
 * conversa daquele navegador. Ele nao decide mais quem e o usuario.
 */
@Controller()
export class ChatController {
  constructor(
    private readonly ai: AiService,
    private readonly memory: ConversationMemoryService,
    private readonly tenant: TenantService,
    private readonly auth: ChatAuthService,
    private readonly config: ConfigService,
  ) {}

  /** Identificador da origem para o limite de tentativas de login. */
  private origem(req: Request): string {
    return req.ip ?? req.socket?.remoteAddress ?? 'desconhecida';
  }

  /** Extrai o token de "Authorization: Bearer <token>". */
  private tokenDoHeader(authorization?: string): string | undefined {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    return authorization.slice('Bearer '.length).trim() || undefined;
  }

  /**
   * Normaliza o sessionId vindo do navegador. Ele so nomeia o historico, mas
   * ainda assim nao entra cru no banco: limita tamanho e alfabeto.
   */
  private sessionIdSeguro(bruto?: string): string {
    const limpo = (bruto ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return limpo || 'padrao';
  }

  /** Troca a senha da instalacao por um token de sessao. */
  @Post('chat/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { senha?: string },
    @Req() req: Request,
  ): Promise<{ token: string }> {
    if (!this.auth.senhaConfigurada()) {
      throw new HttpException(
        'Chat Web bloqueado: defina CHAT_ACCESS_PASSWORD no .env.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const origem = this.origem(req);
    if (!this.auth.podeTentar(origem)) {
      throw new HttpException(
        'Muitas tentativas. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!this.auth.verificarSenha(body?.senha)) {
      // Mensagem generica de proposito: nao revela se a senha existe ou o
      // quanto ela chegou perto.
      throw new HttpException('Senha invalida.', HttpStatus.UNAUTHORIZED);
    }

    const organizationId = this.config
      .get<string>('OWNER_ORGANIZATION_ID')
      ?.trim();
    if (!organizationId) {
      throw new HttpException(
        'OWNER_ORGANIZATION_ID nao configurado no .env.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const tenant = await this.tenant.resolveByOrganization(organizationId);
    if (!tenant) {
      throw new HttpException(
        'Organizacao configurada nao existe no banco.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.auth.limparTentativas(origem);
    return { token: this.auth.emitirToken(organizationId) };
  }

  /** Endpoint do chat: exige token de sessao valido. */
  @Post('chat')
  async chat(
    @Body() body: { message: string; sessionId: string },
    @Headers('authorization') authorization?: string,
  ): Promise<{ reply: string }> {
    const organizationId = this.auth.validarToken(
      this.tokenDoHeader(authorization),
    );
    if (!organizationId) {
      throw new HttpException(
        'Sessao invalida ou expirada.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tenant = await this.tenant.resolveByOrganization(organizationId);
    if (!tenant) {
      throw new HttpException(
        'Sessao invalida ou expirada.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const contact = `web:${this.sessionIdSeguro(body?.sessionId)}`;
    const scope = {
      organizationId: tenant.organization.id,
      userId: tenant.user.id,
    };

    await this.memory.append(contact, { role: 'user', content: body.message }, scope);
    const history = await this.memory.getHistory(contact);
    const reply = await this.ai.generateReply(history, { contact, ...scope });
    await this.memory.append(contact, { role: 'assistant', content: reply }, scope);

    return { reply };
  }

  /** Pagina do Chat Web. */
  @Get('chat')
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(ChatController.HTML);
  }

  private static readonly HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Kyrius — Chat</title>
<style>
  :root { --bg:#0f172a; --panel:#111827; --accent:#7c3aed; --me:#7c3aed; --bot:#1f2937; --text:#e5e7eb; --muted:#9ca3af; --erro:#f87171; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); height:100vh; display:flex; flex-direction:column; }
  header { padding:16px 20px; background:var(--panel); border-bottom:1px solid #1f2937; display:flex; align-items:center; gap:10px; }
  header .logo { width:32px; height:32px; border-radius:8px; background:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:700; }
  header h1 { font-size:18px; margin:0; }
  header small { color:var(--muted); font-weight:400; }
  header .sair { margin-left:auto; background:none; border:1px solid #374151; color:var(--muted); padding:6px 12px; border-radius:8px; font-size:13px; cursor:pointer; }
  #messages { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; max-width:820px; width:100%; margin:0 auto; }
  .msg { padding:10px 14px; border-radius:14px; max-width:78%; white-space:pre-wrap; line-height:1.4; }
  .me { align-self:flex-end; background:var(--me); color:#fff; border-bottom-right-radius:4px; }
  .bot { align-self:flex-start; background:var(--bot); border-bottom-left-radius:4px; }
  .typing { color:var(--muted); font-style:italic; }
  form { display:flex; gap:10px; padding:16px; background:var(--panel); border-top:1px solid #1f2937; max-width:820px; width:100%; margin:0 auto; }
  input { flex:1; padding:12px 14px; border-radius:10px; border:1px solid #374151; background:#0b1220; color:var(--text); font-size:15px; }
  input:focus { outline:none; border-color:var(--accent); }
  button { padding:0 18px; border-radius:10px; border:none; background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #login { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:10; }
  #login .caixa { background:var(--panel); padding:32px; border-radius:16px; width:min(380px,90vw); border:1px solid #1f2937; }
  #login h2 { margin:0 0 6px; font-size:20px; }
  #login p { margin:0 0 20px; color:var(--muted); font-size:14px; }
  #login form { padding:0; background:none; border:none; flex-direction:column; gap:12px; }
  #login button { padding:12px; }
  #erro { color:var(--erro); font-size:13px; min-height:18px; margin-top:10px; }
  .oculto { display:none !important; }
</style></head>
<body>
  <div id="login">
    <div class="caixa">
      <h2>Kyrius</h2>
      <p>Este chat e restrito. Informe a senha de acesso.</p>
      <form id="formLogin">
        <input id="senha" type="password" placeholder="Senha de acesso" autocomplete="current-password" />
        <button type="submit">Entrar</button>
      </form>
      <div id="erro"></div>
    </div>
  </div>

  <header class="oculto" id="cabecalho">
    <div class="logo">K</div>
    <div><h1>Kyrius <small>· assistente</small></h1></div>
    <button class="sair" id="sair">Sair</button>
  </header>
  <div id="messages" class="oculto"></div>
  <form id="form" class="oculto">
    <input id="input" placeholder="Escreva uma mensagem..." autocomplete="off" />
    <button id="send" type="submit">Enviar</button>
  </form>

<script>
  const sessionId = localStorage.getItem('kyrius_session') || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  localStorage.setItem('kyrius_session', sessionId);

  const login = document.getElementById('login');
  const formLogin = document.getElementById('formLogin');
  const senha = document.getElementById('senha');
  const erro = document.getElementById('erro');
  const cabecalho = document.getElementById('cabecalho');
  const messages = document.getElementById('messages');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const sair = document.getElementById('sair');

  function token() { return localStorage.getItem('kyrius_token'); }

  function mostrarChat() {
    login.classList.add('oculto');
    [cabecalho, messages, form].forEach(el => el.classList.remove('oculto'));
    if (!messages.hasChildNodes()) add('Ola! Sou o Kyrius. Como posso ajudar?', 'bot');
    input.focus();
  }

  function mostrarLogin(mensagem) {
    localStorage.removeItem('kyrius_token');
    login.classList.remove('oculto');
    [cabecalho, messages, form].forEach(el => el.classList.add('oculto'));
    erro.textContent = mensagem || '';
    senha.value = '';
    senha.focus();
  }

  function add(text, cls) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.textContent = '';
    try {
      const r = await fetch('/chat/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ senha: senha.value })
      });
      if (!r.ok) {
        const dados = await r.json().catch(() => ({}));
        erro.textContent = dados.message || 'Nao foi possivel entrar.';
        return;
      }
      const dados = await r.json();
      localStorage.setItem('kyrius_token', dados.token);
      mostrarChat();
    } catch (err) {
      erro.textContent = 'Erro ao falar com o servidor.';
    }
  });

  sair.addEventListener('click', () => mostrarLogin(''));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    add(text, 'me');
    input.value = '';
    send.disabled = true;
    const typing = add('digitando...', 'bot typing');
    try {
      const r = await fetch('/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json', 'Authorization':'Bearer ' + token()},
        body: JSON.stringify({ message: text, sessionId })
      });
      typing.remove();
      if (r.status === 401) { mostrarLogin('Sua sessao expirou. Entre novamente.'); return; }
      const data = await r.json();
      add(data.reply || '(sem resposta)', 'bot');
    } catch (err) {
      typing.remove();
      add('Erro ao falar com o servidor.', 'bot');
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  // Token guardado de uma visita anterior: o /chat confirma se ainda vale.
  if (token()) mostrarChat(); else mostrarLogin('');
</script>
</body></html>`;
}
