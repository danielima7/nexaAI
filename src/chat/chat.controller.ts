import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AiService } from '../ai/ai.service';
import { ConversationMemoryService } from '../ai/conversation-memory.service';
import { TenantService } from '../tenant/tenant.service';

/**
 * Chat Web do Kyrius: uma pagina simples servida pelo backend + um endpoint
 * que reaproveita a mesma IA, ferramentas, memoria e multi-tenant do WhatsApp.
 *
 * O "contato" web e identificado por "web:<sessionId>" (gerado no navegador),
 * que vira um usuario/organizacao como qualquer contato.
 */
@Controller()
export class ChatController {
  constructor(
    private readonly ai: AiService,
    private readonly memory: ConversationMemoryService,
    private readonly tenant: TenantService,
  ) {}

  /** Endpoint do chat: recebe a mensagem, responde com a IA (com contexto). */
  @Post('chat')
  async chat(
    @Body() body: { message: string; sessionId: string },
  ): Promise<{ reply: string }> {
    const contact = `web:${body.sessionId}`;
    const { user, organization } = await this.tenant.resolveByWhatsapp(contact);
    const scope = { organizationId: organization.id, userId: user.id };

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
  :root { --bg:#0f172a; --panel:#111827; --accent:#7c3aed; --me:#7c3aed; --bot:#1f2937; --text:#e5e7eb; --muted:#9ca3af; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); height:100vh; display:flex; flex-direction:column; }
  header { padding:16px 20px; background:var(--panel); border-bottom:1px solid #1f2937; display:flex; align-items:center; gap:10px; }
  header .logo { width:32px; height:32px; border-radius:8px; background:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:700; }
  header h1 { font-size:18px; margin:0; }
  header small { color:var(--muted); font-weight:400; }
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
</style></head>
<body>
  <header>
    <div class="logo">K</div>
    <div><h1>Kyrius <small>· assistente</small></h1></div>
  </header>
  <div id="messages"></div>
  <form id="form">
    <input id="input" placeholder="Escreva uma mensagem..." autocomplete="off" />
    <button id="send" type="submit">Enviar</button>
  </form>
<script>
  const sessionId = localStorage.getItem('kyrius_session') || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  localStorage.setItem('kyrius_session', sessionId);
  const messages = document.getElementById('messages');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const send = document.getElementById('send');

  function add(text, cls) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  add('Ola! Sou o Kyrius. Como posso ajudar?', 'bot');

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
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message: text, sessionId })
      });
      const data = await r.json();
      typing.remove();
      add(data.reply || '(sem resposta)', 'bot');
    } catch (err) {
      typing.remove();
      add('Erro ao falar com o servidor.', 'bot');
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
</script>
</body></html>`;
}
