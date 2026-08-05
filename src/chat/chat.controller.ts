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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AiService } from '../ai/ai.service';
import { ConversationMemoryService } from '../ai/conversation-memory.service';
import { ChatAuthService } from './chat-auth.service';
import { ChatAccountService } from './chat-account.service';
import { ConnectionsService } from '../connections/connections.service';
import {
  acharProvedor,
  sugestoesPara,
} from '../connections/provider-catalog';
import { UploadService } from '../uploads/upload.service';
import { SuporteService } from '../suporte/suporte.service';
import { AiUsageService } from '../ai/ai-usage.service';

/**
 * Chat Web do Kyrius: uma pagina simples servida pelo backend + um endpoint
 * que reaproveita a mesma IA, ferramentas, memoria e multi-tenant do WhatsApp.
 *
 * AUTENTICADO POR CONTA: cada pessoa entra com o proprio e-mail e senha, e a
 * organizacao vem do TOKEN DE SESSAO assinado pelo servidor. Antes vinha de um
 * `sessionId` inventado pelo navegador, o que deixava qualquer visitante criar
 * um tenant; depois veio de uma senha unica de instalacao, que so servia para
 * uma organizacao.
 *
 * O `sessionId` continua existindo, mas apenas como chave do historico daquele
 * navegador. Ele nao decide quem e o usuario.
 */
@Controller()
export class ChatController {
  constructor(
    private readonly ai: AiService,
    private readonly memory: ConversationMemoryService,
    private readonly auth: ChatAuthService,
    private readonly contas: ChatAccountService,
    private readonly connections: ConnectionsService,
    private readonly uploads: UploadService,
    private readonly suporte: SuporteService,
    private readonly usoIa: AiUsageService,
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

  /** Troca e-mail + senha por um token de sessao. */
  @Post('chat/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email?: string; senha?: string },
    @Req() req: Request,
  ): Promise<{ token: string; nome: string | null }> {
    const origem = this.origem(req);
    if (!this.auth.podeTentar(origem)) {
      throw new HttpException(
        'Muitas tentativas. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Mensagem generica de proposito em todos os casos: nao revelamos se o
    // e-mail existe, o que evita enumerar contas de clientes.
    const recusar = () => {
      throw new HttpException(
        'E-mail ou senha invalidos.',
        HttpStatus.UNAUTHORIZED,
      );
    };

    if (!body?.email || !body?.senha) recusar();

    const conta = await this.contas.buscarPorEmail(body.email as string);
    if (!conta || !conta.passwordHash) recusar();

    if (!this.contas.conferirSenha(body.senha as string, conta!.passwordHash)) {
      recusar();
    }

    this.auth.limparTentativas(origem);
    await this.contas.registrarLogin(conta!.id);

    return {
      token: this.auth.emitirToken({
        organizationId: conta!.organizationId,
        userId: conta!.id,
      }),
      nome: conta!.name,
    };
  }

  /**
   * Tela inicial do chat: saudacao e perguntas sugeridas.
   *
   * A tela em branco e a maior barreira de um produto conversacional — o dono
   * da empresa nao imagina o que pode pedir. As sugestoes saem do que a
   * organizacao realmente conectou, entao ninguem recebe a dica de perguntar
   * por inadimplentes sem ter o financeiro ligado.
   */
  @Get('chat/inicio')
  async inicio(
    @Headers('authorization') authorization?: string,
  ): Promise<{ saudacao: string; sugestoes: string[] }> {
    const sessao = this.auth.validarToken(this.tokenDoHeader(authorization));
    if (!sessao) {
      throw new HttpException(
        'Sessao invalida ou expirada.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const conectados = await this.connections.listProviders(
      sessao.organizationId,
    );
    const nomes = conectados
      .map((id) => acharProvedor(id)?.nome ?? id)
      .filter(Boolean);

    const saudacao =
      nomes.length === 0
        ? 'Ola! Sou o Kyrius. Ainda nao ha nenhuma conta conectada — assim que voce conectar em "Integracoes", posso consultar seus dados e responder sobre o seu negocio.'
        : `Ola! Sou o Kyrius. Ja estou conectado a ${nomes.join(', ')}. Pode perguntar o que quiser sobre o seu negocio.`;

    return { saudacao, sugestoes: sugestoesPara(conectados) };
  }

  /** Endpoint do chat: exige token de sessao valido. */
  @Post('chat')
  async chat(
    @Body() body: { message: string; sessionId: string },
    @Headers('authorization') authorization?: string,
  ): Promise<{ reply: string }> {
    const sessao = this.auth.validarToken(this.tokenDoHeader(authorization));
    if (!sessao) {
      throw new HttpException(
        'Sessao invalida ou expirada.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // O token e assinado, mas a conta pode ter sido removida desde a emissao.
    const dados = await this.contas.carregarSessao(
      sessao.userId,
      sessao.organizationId,
    );
    if (!dados) {
      throw new HttpException(
        'Sessao invalida ou expirada.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Teto de mensagens (contas de autocadastro). Conferido ANTES de chamar a
    // IA — verificar depois nao impediria o gasto, so registraria que ocorreu.
    // Organizacao sem `limiteInteracoes` (todo cliente que voce cadastra por
    // convite) passa direto.
    const limite = dados.organizacao.limiteInteracoes;
    if (limite !== null && limite !== undefined) {
      const usadas = await this.usoIa.contarInteracoes(sessao.organizationId);
      if (usadas >= limite) {
        // 200 com texto, e nao erro HTTP: para quem esta conversando, um erro
        // tecnico parece defeito. A conta e os dados continuam intactos.
        return {
          reply:
            `Voce usou as ${limite} mensagens da conta gratuita.\n\n` +
            'Seus dados e integracoes continuam salvos. Para liberar o uso ' +
            'completo, fale com a gente pelo WhatsApp no rodape do site — ' +
            'respondemos no mesmo dia.',
        };
      }
    }

    const contact = `web:${this.sessionIdSeguro(body?.sessionId)}`;
    const scope = {
      organizationId: sessao.organizationId,
      userId: sessao.userId,
    };

    await this.memory.append(contact, { role: 'user', content: body.message }, scope);
    const history = await this.memory.getHistory(contact);
    const reply = await this.ai.generateReply('chat', history, {
      contact,
      ...scope,
      // Em organizacao de demonstracao, as ferramentas devolvem dados ficticios.
      demo: dados.organizacao.demo,
    });
    await this.memory.append(contact, { role: 'assistant', content: reply }, scope);

    return { reply };
  }

  /**
   * Recebe uma planilha enviada pelo cliente.
   *
   * O arquivo e convertido em texto na hora e so o texto e guardado — o
   * binario e descartado. A IA le depois, sob demanda, pela ferramenta
   * `arquivo_ler`.
   */
  @Post('chat/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('arquivo'))
  async upload(
    @UploadedFile() arquivo: Express.Multer.File,
    @Headers('authorization') authorization?: string,
  ): Promise<{ nome: string; linhas: number; abas: string[] }> {
    const sessao = this.auth.validarToken(this.tokenDoHeader(authorization));
    if (!sessao) {
      throw new HttpException(
        'Sessao invalida ou expirada.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!arquivo) {
      throw new HttpException('Nenhum arquivo enviado.', HttpStatus.BAD_REQUEST);
    }

    if (!this.uploads.extensaoValida(arquivo.originalname)) {
      throw new HttpException(
        `Formato nao suportado. Envie ${UploadService.EXTENSOES.join(', ')}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (arquivo.size > UploadService.MAX_BYTES) {
      throw new HttpException(
        `Arquivo muito grande (maximo ${UploadService.MAX_BYTES / 1024 / 1024} MB).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    let extraida;
    try {
      extraida = this.uploads.extrair(arquivo.buffer);
    } catch (e: any) {
      throw new HttpException(
        e?.message ?? 'Nao consegui ler esta planilha.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const registro = await this.uploads.salvar({
      organizationId: sessao.organizationId,
      userId: sessao.userId,
      nomeArquivo: arquivo.originalname,
      extraida,
    });

    return {
      nome: registro.nomeArquivo,
      linhas: registro.totalLinhas,
      abas: extraida.abas,
    };
  }

  /**
   * HTML da pagina com o botao de suporte ja resolvido.
   *
   * Montado uma vez e reaproveitado: o numero vem de configuracao, que nao
   * muda enquanto o processo vive, entao refazer a substituicao a cada
   * requisicao seria trabalho jogado fora.
   */
  private paginaCache?: string;

  private get pagina(): string {
    if (this.paginaCache === undefined) {
      const url = this.suporte.link(
        'Ola! Preciso de ajuda com o Kyrius.',
      );
      // Sem numero configurado, o marcador vira vazio e o botao some — melhor
      // do que um link que leva o cliente a uma tela de erro do WhatsApp
      // justamente quando ele precisa de ajuda.
      const botao = url
        ? `<a class="suporte" href="${url}" target="_blank" rel="noopener noreferrer" title="Fale conosco via WhatsApp">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.13c-.24.68-1.42 1.31-1.95 1.36-.5.05-.99.24-3.35-.7-2.82-1.11-4.6-3.99-4.74-4.18-.14-.19-1.13-1.5-1.13-2.86 0-1.36.71-2.03.96-2.31.25-.28.55-.35.73-.35.18 0 .37 0 .53.01.17.01.4-.07.62.47.24.57.8 1.97.87 2.11.07.14.12.31.02.5-.09.19-.14.31-.28.47-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.17-.19.69-.8.88-1.08.19-.28.37-.23.62-.14.25.09 1.6.75 1.87.89.28.14.46.21.53.33.07.12.07.69-.17 1.36z"/></svg>
        <span>Fale conosco</span>
      </a>`
        : '';

      this.paginaCache = ChatController.HTML.replace(
        '<!--BOTAO_SUPORTE-->',
        botao,
      );
    }

    return this.paginaCache;
  }

  /** Pagina do Chat Web. */
  @Get('chat')
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.pagina);
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
  header .acoes { margin-left:auto; display:flex; gap:8px; align-items:center; }
  header .sair, header .integracoes { background:none; border:1px solid #374151; color:var(--muted); padding:6px 12px; border-radius:8px; font-size:13px; cursor:pointer; text-decoration:none; display:inline-block; }
  /* Verde do WhatsApp: e o unico elemento colorido do cabecalho, entao vira o
     caminho obvio quando algo da errado — que e o comportamento que queremos
     estimular no piloto. */
  header .suporte { display:inline-flex; align-items:center; gap:6px; background:none; border:1px solid #25603f; color:#4ade80; padding:6px 12px; border-radius:8px; font-size:13px; text-decoration:none; white-space:nowrap; }
  header .suporte:hover { border-color:#25d366; color:#25d366; }
  /* Em tela estreita sobra so o icone: com tres itens, o texto empurraria o
     cabecalho e quebraria a linha no celular — que e onde o dono vai abrir. */
  @media (max-width:520px) { header .suporte span { display:none; } }
  #messages { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; max-width:820px; width:100%; margin:0 auto; }
  .msg { padding:10px 14px; border-radius:14px; max-width:78%; white-space:pre-wrap; line-height:1.4; }
  .me { align-self:flex-end; background:var(--me); color:#fff; border-bottom-right-radius:4px; }
  .bot { align-self:flex-start; background:var(--bot); border-bottom-left-radius:4px; }
  .typing { color:var(--muted); font-style:italic; }
  #sugestoes { display:flex; flex-wrap:wrap; gap:8px; align-self:flex-start; max-width:78%; margin-top:-4px; }
  #sugestoes button { background:none; border:1px solid #374151; color:var(--muted); padding:8px 14px; border-radius:20px; font-size:13px; font-weight:400; cursor:pointer; text-align:left; }
  #sugestoes button:hover { border-color:var(--accent); color:var(--text); }
  form { display:flex; gap:10px; padding:16px; background:var(--panel); border-top:1px solid #1f2937; max-width:820px; width:100%; margin:0 auto; }
  input { flex:1; padding:12px 14px; border-radius:10px; border:1px solid #374151; background:#0b1220; color:var(--text); font-size:15px; }
  input:focus { outline:none; border-color:var(--accent); }
  button { padding:0 18px; border-radius:10px; border:none; background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .anexo { background:none; border:1px solid #374151; color:var(--muted); padding:0 14px; font-size:17px; }
  .anexo:hover { border-color:var(--accent); }
  #login { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:10; }
  #login .caixa { background:var(--panel); padding:32px; border-radius:16px; width:min(380px,90vw); border:1px solid #1f2937; }
  #login h2 { margin:0 0 6px; font-size:20px; }
  #login p { margin:0 0 20px; color:var(--muted); font-size:14px; }
  #login form { padding:0; background:none; border:none; flex-direction:column; gap:12px; }
  #login input { width:100%; }
  #login button { padding:12px; }
  #erro { color:var(--erro); font-size:13px; min-height:18px; margin-top:10px; }
  .oculto { display:none !important; }
  /* Rodape institucional. Discreto de proposito: o chat e uma ferramenta de
     trabalho, nao um documento — os links precisam existir (o cliente aceita
     termos ao usar o servico) sem competir com a conversa. */
  .legais { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 18px;
            padding:0 16px 14px; max-width:820px; width:100%; margin:0 auto; }
  .legais a { color:#6b7a91; font-size:12.5px; text-decoration:none; }
  .legais a:hover { color:var(--muted); text-decoration:underline; }
  .legais a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }
  #login .legais { padding:20px 0 0; margin-top:18px; border-top:1px solid #1f2937; }
</style></head>
<body>
  <div id="login">
    <div class="caixa">
      <h2>Kyrius</h2>
      <p>Entre com o e-mail e a senha da sua empresa.</p>
      <form id="formLogin">
        <input id="email" type="email" placeholder="E-mail" autocomplete="username" />
        <input id="senha" type="password" placeholder="Senha" autocomplete="current-password" />
        <button type="submit">Entrar</button>
      </form>
      <div id="erro"></div>
      <nav class="legais" aria-label="Documentos institucionais">
        <a href="/privacidade">Privacidade</a>
        <a href="/termos">Termos</a>
        <a href="/seguranca">Segurança</a>
        <a href="/acessibilidade">Acessibilidade</a>
      </nav>
    </div>
  </div>

  <header class="oculto" id="cabecalho">
    <div class="logo">K</div>
    <div><h1>Kyrius <small id="quem">· assistente</small></h1></div>
    <div class="acoes">
      <!--BOTAO_SUPORTE-->
      <a class="integracoes" href="/integracoes">Integracoes</a>
      <button class="sair" id="sair">Sair</button>
    </div>
  </header>
  <div id="messages" class="oculto"></div>
  <form id="form" class="oculto">
    <input type="file" id="arquivo" accept=".xlsx,.xls,.csv" style="display:none" />
    <button type="button" id="anexar" class="anexo" title="Enviar planilha (Excel ou CSV)">📎</button>
    <input id="input" placeholder="Escreva uma mensagem..." autocomplete="off" />
    <button id="send" type="submit">Enviar</button>
  </form>

  <nav class="legais oculto" id="legais" aria-label="Documentos institucionais">
    <a href="/privacidade">Privacidade</a>
    <a href="/termos">Termos</a>
    <a href="/seguranca">Segurança</a>
    <a href="/acessibilidade">Acessibilidade</a>
  </nav>

<script>
  const sessionId = localStorage.getItem('kyrius_session') || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  localStorage.setItem('kyrius_session', sessionId);

  const login = document.getElementById('login');
  const formLogin = document.getElementById('formLogin');
  const email = document.getElementById('email');
  const senha = document.getElementById('senha');
  const erro = document.getElementById('erro');
  const cabecalho = document.getElementById('cabecalho');
  const legais = document.getElementById('legais');
  const quem = document.getElementById('quem');
  const messages = document.getElementById('messages');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const sair = document.getElementById('sair');

  function token() { return localStorage.getItem('kyrius_token'); }

  function mostrarChat() {
    login.classList.add('oculto');
    [cabecalho, messages, form, legais].forEach(el => el.classList.remove('oculto'));
    const nome = localStorage.getItem('kyrius_nome');
    if (nome) quem.textContent = '· ' + nome;
    if (!messages.hasChildNodes()) carregarInicio();
    input.focus();
  }

  // Saudacao e sugestoes vem do servidor, montadas a partir do que a
  // organizacao conectou — nao adianta sugerir "quem esta inadimplente?"
  // para quem nao ligou o financeiro.
  async function carregarInicio() {
    let dados = { saudacao: 'Ola! Sou o Kyrius. Como posso ajudar?', sugestoes: [] };
    try {
      const r = await fetch('/chat/inicio', {
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      if (r.status === 401) { mostrarLogin('Sua sessao expirou. Entre novamente.'); return; }
      if (r.ok) dados = await r.json();
    } catch (err) { /* mantem a saudacao padrao */ }

    add(dados.saudacao, 'bot');
    if (dados.sugestoes && dados.sugestoes.length) mostrarSugestoes(dados.sugestoes);
  }

  function mostrarSugestoes(lista) {
    const caixa = document.createElement('div');
    caixa.id = 'sugestoes';
    for (const texto of lista) {
      const chip = document.createElement('button');
      chip.textContent = texto;
      chip.onclick = () => {
        caixa.remove();
        input.value = texto;
        form.requestSubmit();
      };
      caixa.appendChild(chip);
    }
    messages.appendChild(caixa);
    messages.scrollTop = messages.scrollHeight;
  }

  function mostrarLogin(mensagem) {
    localStorage.removeItem('kyrius_token');
    login.classList.remove('oculto');
    [cabecalho, messages, form, legais].forEach(el => el.classList.add('oculto'));
    erro.textContent = mensagem || '';
    senha.value = '';
    (email.value ? senha : email).focus();
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
        body: JSON.stringify({ email: email.value, senha: senha.value })
      });
      if (!r.ok) {
        const dados = await r.json().catch(() => ({}));
        erro.textContent = dados.message || 'Nao foi possivel entrar.';
        return;
      }
      const dados = await r.json();
      localStorage.setItem('kyrius_token', dados.token);
      if (dados.nome) localStorage.setItem('kyrius_nome', dados.nome);
      mostrarChat();
    } catch (err) {
      erro.textContent = 'Erro ao falar com o servidor.';
    }
  });

  sair.addEventListener('click', () => {
    localStorage.removeItem('kyrius_nome');
    mostrarLogin('');
  });

  // --- Envio de planilha ---
  const arquivo = document.getElementById('arquivo');
  const anexar = document.getElementById('anexar');

  anexar.addEventListener('click', () => arquivo.click());

  arquivo.addEventListener('change', async () => {
    const f = arquivo.files && arquivo.files[0];
    if (!f) return;

    const chips = document.getElementById('sugestoes');
    if (chips) chips.remove();

    add('📎 ' + f.name, 'me');
    const enviando = add('lendo a planilha...', 'bot typing');
    anexar.disabled = true;

    try {
      const dados = new FormData();
      dados.append('arquivo', f);
      const r = await fetch('/chat/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() },
        body: dados
      });
      enviando.remove();

      if (r.status === 401) { mostrarLogin('Sua sessao expirou. Entre novamente.'); return; }

      const resp = await r.json().catch(() => ({}));
      if (!r.ok) {
        add(resp.message || 'Nao consegui ler este arquivo.', 'bot');
        return;
      }

      add(
        'Planilha "' + resp.nome + '" recebida — ' + resp.linhas + ' linhas' +
        (resp.abas && resp.abas.length > 1 ? ' em ' + resp.abas.length + ' abas' : '') +
        '. Pode perguntar o que quiser sobre ela.',
        'bot'
      );
    } catch (err) {
      enviando.remove();
      add('Erro ao enviar o arquivo.', 'bot');
    } finally {
      anexar.disabled = false;
      arquivo.value = '';
      input.focus();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    // Escrever a propria pergunta tambem dispensa as sugestoes.
    const chips = document.getElementById('sugestoes');
    if (chips) chips.remove();
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
