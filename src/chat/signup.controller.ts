import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SignupService } from './signup.service';
import { ChatAuthService } from './chat-auth.service';

/**
 * Cadastro aberto: `GET /criar-conta` serve a pagina, `POST /criar-conta`
 * cria a conta e ja devolve a sessao — o visitante cai direto no chat.
 *
 * Quando a rota esta desligada (KYRIUS_AUTOCADASTRO != true) o GET responde
 * 404 em vez de uma pagina de "indisponivel". Uma rota desligada nao deveria
 * anunciar que existe: quem varre endpoints procurando cadastro aberto merece
 * um 404, nao uma pista.
 */
@Controller('criar-conta')
export class SignupController {
  constructor(
    private readonly signup: SignupService,
    private readonly auth: ChatAuthService,
  ) {}

  private origem(req: Request): string {
    return req.ip ?? req.socket?.remoteAddress ?? 'desconhecida';
  }

  @Get()
  page(@Res() res: Response): void {
    if (!this.signup.habilitado) {
      res.status(HttpStatus.NOT_FOUND).send('Nao encontrado.');
      return;
    }
    const limite = this.signup.limite;
    // Sem teto, a pagina nao promete cota nenhuma — anunciar "20 mensagens"
    // quando nao ha limite seria mentir para o visitante.
    const nota =
      limite === null
        ? 'Voce cria a conta e ja comeca a usar. Precisando de ajuda para conectar seus sistemas, fale com a gente.'
        : `A conta gratuita inclui <strong>${limite} mensagens</strong> para voce conhecer o Kyrius. ` +
          'Depois disso, e so falar com a gente para liberar o uso completo — seus dados e integracoes continuam onde estao.';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(SignupController.HTML.replace(/__NOTA__/g, nota));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async criar(
    @Body()
    body: { email?: string; senha?: string; nome?: string; empresa?: string },
    @Req() req: Request,
  ): Promise<{ token: string; nome: string | null }> {
    if (!this.signup.habilitado) {
      throw new HttpException('Nao encontrado.', HttpStatus.NOT_FOUND);
    }

    // Reusa o limitador do login: 8 tentativas por IP a cada 15 minutos. Sem
    // isso, um script criaria centenas de organizacoes em minutos — cada uma
    // com direito ao seu teto de mensagens, o que soma custo real.
    if (!this.auth.podeTentar(this.origem(req))) {
      throw new HttpException(
        'Muitas tentativas. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const conta = await this.signup.criar(body ?? {});
      return {
        token: this.auth.emitirToken({
          organizationId: conta.organizationId,
          userId: conta.userId,
        }),
        nome: conta.nome,
      };
    } catch (erro: unknown) {
      const mensagem =
        erro instanceof Error ? erro.message : 'Nao foi possivel criar a conta.';
      throw new HttpException(mensagem, HttpStatus.BAD_REQUEST);
    }
  }

  private static readonly HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Criar conta — Kyrius</title>
<style>
  :root { --breu:#080b14; --painel:#0f1729; --borda:#1e2a44; --tinta:#e8edf7;
          --tinta-fraca:#94a3b8; --azul:#2563eb; --azul-vivo:#3b82f6; --erro:#f87171; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--breu); color:var(--tinta); padding:24px;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .caixa { background:var(--painel); border:1px solid var(--borda); border-radius:16px;
           padding:36px; width:min(430px,100%); }
  h1 { font-size:23px; margin:0 0 6px; letter-spacing:-.02em; }
  .sub { color:var(--tinta-fraca); font-size:15px; margin:0 0 26px; line-height:1.55; }
  label { display:block; font-size:14px; color:var(--tinta-fraca); margin:16px 0 6px; }
  input { width:100%; padding:12px 14px; border-radius:10px; border:1px solid #374151;
          background:#0b1220; color:var(--tinta); font-size:15px; }
  input:focus { outline:none; border-color:var(--azul-vivo); }
  button { width:100%; margin-top:24px; padding:14px; border-radius:10px; border:none;
           background:var(--azul); color:#fff; font-weight:600; font-size:16px; cursor:pointer; }
  button:hover:not(:disabled) { background:var(--azul-vivo); }
  button:disabled { opacity:.5; cursor:default; }
  .erro { color:var(--erro); font-size:14px; min-height:20px; margin-top:14px; }
  .nota { margin-top:22px; padding-top:20px; border-top:1px solid var(--borda);
          color:var(--tinta-fraca); font-size:13.5px; line-height:1.6; }
  .entrar { display:block; margin-top:18px; text-align:center; color:var(--tinta-fraca); font-size:14px; }
  .entrar:hover { color:var(--tinta); }
</style></head>
<body>
  <div class="caixa">
    <h1>Criar sua conta</h1>
    <p class="sub">Em um minuto voce ja esta conversando com o Kyrius.</p>

    <form id="formulario">
      <label for="empresa">Nome da empresa</label>
      <input id="empresa" required placeholder="Auto Pecas Silva" />

      <label for="nome">Seu nome</label>
      <input id="nome" placeholder="Como podemos te chamar" autocomplete="name" />

      <label for="email">E-mail</label>
      <input id="email" type="email" required placeholder="voce@suaempresa.com.br" autocomplete="username" />

      <label for="senha">Senha</label>
      <input id="senha" type="password" required placeholder="Ao menos 8 caracteres" autocomplete="new-password" />

      <button type="submit" id="enviar">Criar conta e entrar</button>
      <div class="erro" id="erro"></div>
    </form>

    <p class="nota">__NOTA__</p>
    <a class="entrar" href="/chat">Ja tenho conta</a>
  </div>

<script>
  const f = document.getElementById('formulario');
  const erro = document.getElementById('erro');
  const enviar = document.getElementById('enviar');

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.textContent = '';

    const senha = document.getElementById('senha').value;
    if (senha.length < 8) {
      erro.textContent = 'A senha precisa ter ao menos 8 caracteres.';
      return;
    }

    enviar.disabled = true;
    try {
      const r = await fetch('/criar-conta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa: document.getElementById('empresa').value,
          nome: document.getElementById('nome').value,
          email: document.getElementById('email').value.trim(),
          senha
        })
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) {
        erro.textContent = dados.message || 'Nao foi possivel criar a conta.';
        enviar.disabled = false;
        return;
      }
      localStorage.setItem('kyrius_token', dados.token);
      if (dados.nome) localStorage.setItem('kyrius_nome', dados.nome);
      location.href = '/chat';
    } catch (err) {
      erro.textContent = 'Erro ao falar com o servidor.';
      enviar.disabled = false;
    }
  });
</script>
</body></html>`;
}
