import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InviteService } from './invite.service';
import { ChatAuthService } from './chat-auth.service';

/**
 * Aceite de convite: a porta de entrada de um cliente novo.
 *
 * `GET /convite?token=...` serve a pagina onde a pessoa escolhe a propria
 * senha; `POST /convite/aceitar` cria a conta e ja devolve um token de sessao,
 * para o cliente cair direto no chat sem precisar fazer login em seguida.
 */
@Controller('convite')
export class InviteController {
  constructor(
    private readonly convites: InviteService,
    private readonly auth: ChatAuthService,
  ) {}

  private origem(req: Request): string {
    return req.ip ?? req.socket?.remoteAddress ?? 'desconhecida';
  }

  /** Dados publicos do convite — usados pela pagina para se apresentar. */
  @Get('info')
  async info(
    @Query('token') token: string,
  ): Promise<{ email: string | null; empresa: string | null }> {
    const convite = await this.convites.validar(token);
    if (!convite) {
      throw new HttpException(
        'Convite invalido, expirado ou ja utilizado.',
        HttpStatus.NOT_FOUND,
      );
    }
    // `email: null` sinaliza convite ABERTO — a pagina libera o campo para o
    // cliente digitar o proprio endereco.
    return { email: convite.email, empresa: convite.companyName };
  }

  /** Cria a conta com a senha escolhida e devolve a sessao ja autenticada. */
  @Post('aceitar')
  @HttpCode(HttpStatus.OK)
  async aceitar(
    @Body() body: { token?: string; senha?: string; nome?: string; email?: string },
    @Req() req: Request,
  ): Promise<{ token: string; nome: string | null }> {
    // O convite ja e um segredo forte, mas o limite de tentativas protege
    // contra alguem varrendo tokens no mesmo endpoint.
    if (!this.auth.podeTentar(this.origem(req))) {
      throw new HttpException(
        'Muitas tentativas. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!body?.token) {
      throw new HttpException('Convite ausente.', HttpStatus.BAD_REQUEST);
    }

    try {
      const aceito = await this.convites.aceitar(body.token, {
        senha: body.senha ?? '',
        nome: body.nome,
        // Usado apenas em convite aberto; num convite direcionado o servico
        // descarta este valor e mantem o e-mail do proprio convite.
        email: body.email,
      });

      return {
        token: this.auth.emitirToken({
          organizationId: aceito.organizationId,
          userId: aceito.userId,
        }),
        nome: aceito.nome,
      };
    } catch (e: any) {
      // Mensagens deste fluxo sao seguras de mostrar (nao revelam dados de
      // terceiros) e ajudam o cliente a entender o que fazer.
      throw new HttpException(
        e?.message ?? 'Nao foi possivel aceitar o convite.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Pagina de aceite. */
  @Get()
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(InviteController.HTML);
  }

  private static readonly HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Kyrius — Criar acesso</title>
<style>
  :root { --bg:#0f172a; --panel:#111827; --accent:#7c3aed; --text:#e5e7eb; --muted:#9ca3af; --erro:#f87171; --ok:#34d399; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
  .caixa { background:var(--panel); padding:32px; border-radius:16px; width:min(420px,100%); border:1px solid #1f2937; }
  .logo { width:40px; height:40px; border-radius:10px; background:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; margin-bottom:16px; }
  h2 { margin:0 0 6px; font-size:22px; }
  p.sub { margin:0 0 22px; color:var(--muted); font-size:14px; line-height:1.5; }
  label { display:block; font-size:13px; color:var(--muted); margin:14px 0 6px; }
  input { width:100%; padding:12px 14px; border-radius:10px; border:1px solid #374151; background:#0b1220; color:var(--text); font-size:15px; }
  input:focus { outline:none; border-color:var(--accent); }
  input:disabled { opacity:.6; }
  button { width:100%; margin-top:20px; padding:13px; border-radius:10px; border:none; background:var(--accent); color:#fff; font-weight:600; font-size:15px; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .msg { font-size:13px; min-height:18px; margin-top:12px; }
  .erro { color:var(--erro); }
  .ok { color:var(--ok); }
  .oculto { display:none !important; }
</style></head>
<body>
  <div class="caixa">
    <div class="logo">K</div>

    <div id="carregando">
      <h2>Kyrius</h2>
      <p class="sub">Verificando seu convite...</p>
    </div>

    <div id="invalido" class="oculto">
      <h2>Convite indisponivel</h2>
      <p class="sub">Este convite expirou, ja foi utilizado ou nao existe. Peca um novo para quem enviou.</p>
    </div>

    <form id="formulario" class="oculto">
      <h2>Criar seu acesso</h2>
      <p class="sub" id="apresentacao"></p>

      <label for="email">E-mail</label>
      <input id="email" type="email" disabled autocomplete="username" placeholder="voce@suaempresa.com.br" />

      <label for="nome">Seu nome</label>
      <input id="nome" type="text" placeholder="Como devemos te chamar" autocomplete="name" />

      <label for="senha">Senha</label>
      <input id="senha" type="password" placeholder="Minimo de 8 caracteres" autocomplete="new-password" />

      <label for="confirmar">Confirme a senha</label>
      <input id="confirmar" type="password" autocomplete="new-password" />

      <button type="submit" id="enviar">Criar acesso e entrar</button>
      <div class="msg erro" id="erro"></div>
    </form>
  </div>

<script>
  const token = new URLSearchParams(location.search).get('token');
  const carregando = document.getElementById('carregando');
  const invalido = document.getElementById('invalido');
  const formulario = document.getElementById('formulario');
  const apresentacao = document.getElementById('apresentacao');
  const email = document.getElementById('email');
  const nome = document.getElementById('nome');
  const senha = document.getElementById('senha');
  const confirmar = document.getElementById('confirmar');
  const enviar = document.getElementById('enviar');
  const erro = document.getElementById('erro');

  function mostrarInvalido() {
    carregando.classList.add('oculto');
    formulario.classList.add('oculto');
    invalido.classList.remove('oculto');
  }

  async function carregar() {
    if (!token) return mostrarInvalido();
    try {
      const r = await fetch('/convite/info?token=' + encodeURIComponent(token));
      if (!r.ok) return mostrarInvalido();
      const dados = await r.json();

      // Convite ABERTO (email nulo): o cliente informa o proprio endereco.
      // Convite DIRECIONADO: campo preenchido e travado, para deixar claro
      // que aquele acesso e daquela pessoa.
      const aberto = !dados.email;
      email.value = dados.email || '';
      email.disabled = !aberto;

      const naEmpresa = dados.empresa ? ' na ' + dados.empresa : '';
      apresentacao.textContent = aberto
        ? 'Voce foi convidado para usar o Kyrius' + naEmpresa + '. Informe seu e-mail e escolha uma senha.'
        : 'Voce foi convidado para usar o Kyrius' + naEmpresa + '. Escolha uma senha para entrar.';

      carregando.classList.add('oculto');
      formulario.classList.remove('oculto');
      (aberto ? email : nome).focus();
    } catch (e) {
      mostrarInvalido();
    }
  }

  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.textContent = '';

    // Conferencia local so para dar retorno imediato — quem decide e o
    // servidor, que revalida tudo.
    if (!email.disabled && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.value.trim())) {
      erro.textContent = 'Informe um e-mail valido.';
      email.focus();
      return;
    }
    if (senha.value.length < 8) {
      erro.textContent = 'A senha precisa ter ao menos 8 caracteres.';
      return;
    }
    if (senha.value !== confirmar.value) {
      erro.textContent = 'As senhas nao conferem.';
      return;
    }

    enviar.disabled = true;
    try {
      const r = await fetch('/convite/aceitar', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token, senha: senha.value, nome: nome.value, email: email.value.trim() })
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) {
        erro.textContent = dados.message || 'Nao foi possivel criar o acesso.';
        enviar.disabled = false;
        return;
      }
      // Ja entra logado: guarda a sessao e segue para o chat.
      localStorage.setItem('kyrius_token', dados.token);
      if (dados.nome) localStorage.setItem('kyrius_nome', dados.nome);
      location.href = '/chat';
    } catch (err) {
      erro.textContent = 'Erro ao falar com o servidor.';
      enviar.disabled = false;
    }
  });

  carregar();
</script>
</body></html>`;
}
