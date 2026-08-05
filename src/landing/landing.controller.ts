import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SuporteService } from '../suporte/suporte.service';

/**
 * Pagina publica de apresentacao do produto, servida na raiz do dominio.
 *
 * Mora aqui, e nao em um site externo, porque prospeccao B2B depende do
 * dominio proprio: o cliente ve kyrius.com.br, clica em "agendar" e cai no
 * WhatsApp; depois entra no mesmo dominio para usar o produto. Um link de
 * plataforma de terceiro no meio desse caminho custa credibilidade
 * justamente com quem esta decidindo se confia dados financeiros a voce.
 *
 * REGRA DE CONTEUDO: so entra o que existe e funciona hoje. Nada de
 * depoimento, logo de cliente ou numero de resultado — nenhuma empresa usou o
 * produto ainda — e nada de integracao planejada (Sankhya, TOTVS, Bling,
 * Omie estao no CLAUDE.md como visao, nao como codigo). Prometer o que nao
 * existe gera a reuniao que termina em constrangimento.
 *
 * ⚠️ O TEXTO VISIVEL AO CLIENTE E ACENTUADO. Os comentarios do projeto sao
 * sem acento por convencao, mas isso vale para codigo — nao para a peca de
 * prospeccao, onde "portugues" no lugar de "português" custa credibilidade
 * antes da primeira frase ser lida.
 */
@Controller()
export class LandingController {
  private paginaCache?: string;

  constructor(
    private readonly suporte: SuporteService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.pagina);
  }

  /** Monta uma vez: contato vem de configuracao e nao muda em execucao. */
  private get pagina(): string {
    if (this.paginaCache === undefined) {
      // Canal COMERCIAL, nao o de suporte: quem chega pela pagina publica esta
      // pedindo demonstracao, nao socorro.
      const zap = this.suporte.linkComercial(
        'Quero saber mais sobre a Kyrius',
      );
      const email =
        this.config.get<string>('KYRIUS_CONTATO_EMAIL') ??
        'contato@kyrius.com.br';

      // Sem WhatsApp configurado, o botao cai no e-mail em vez de sumir: uma
      // landing sem caminho de contato e so uma pagina bonita.
      const destino = zap
        ? `href="${zap}" target="_blank" rel="noopener noreferrer"`
        : `href="mailto:${email}?subject=Demonstra%C3%A7%C3%A3o%20do%20Kyrius"`;

      this.paginaCache = LandingController.HTML.replace(
        /<!--CTA-->/g,
        `<a class="btn btn-primario" ${destino}>Conheça agora <span aria-hidden="true">&rarr;</span></a>`,
      )
        .replace(
          /<!--CTA_TOPO-->/g,
          `<a class="btn btn-topo" ${destino}>Conheça agora</a>`,
        )
        .replace(/<!--EMAIL-->/g, email);
    }

    return this.paginaCache;
  }

  /**
   * Simbolo da marca, embutido como SVG.
   *
   * Inline, e nao como arquivo: a pagina continua sem nenhuma requisicao
   * externa, carrega em uma viagem so no 4G do cliente e nao quebra se um
   * caminho de asset mudar no deploy. O gradiente e o mesmo da marca —
   * desenhada sobre fundo escuro, que e o motivo de a pagina ser escura.
   */
  private static readonly LOGO = `<svg class="logo" viewBox="0 0 210 128" role="img" aria-label="Kyrius">
  <defs>
    <linearGradient id="kyriusGrad" x1="0" y1="0.5" x2="1" y2="0.35">
      <stop offset="0%" stop-color="#1d4ed8"/>
      <stop offset="38%" stop-color="#0ea5e9"/>
      <stop offset="62%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#84cc16"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#kyriusGrad)" stroke-width="21" stroke-linecap="square">
    <path d="M105,64 C105,36 84,20 62,20 C36,20 16,39 16,64 C16,89 36,108 62,108 C84,108 105,92 105,64 C105,36 126,20 148,20 C174,20 194,39 194,64 C194,89 174,108 148,108"/>
    <path d="M119,52 L186,124"/>
  </g>
</svg>`;

  private static readonly HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Kyrius — Converse com os sistemas da sua empresa</title>
<meta name="description" content="Pergunte em português e saiba quem está devendo, o que vence essa semana e o que aconteceu no seu CRM — sem abrir sistema nenhum."/>
<style>
  /* Escuro porque a marca foi desenhada sobre preto: no fundo claro o
     gradiente azul-verde da logo perde forca. O azul continua sendo a cor de
     acao — e sobre fundo escuro ele fica mais eletrico, nao menos. */
  :root {
    --breu:#080b14; --painel:#0f1729; --painel-alto:#151f36;
    --borda:#1e2a44; --borda-forte:#2c3b5c;
    /* O tenue e #73839b, e nao um cinza mais escuro: abaixo disso o contraste
       sobre o breu cai de 4.5:1 e o aviso da demonstracao — justamente o texto
       que diz que nada e alterado sem confirmar — fica ilegivel no celular. */
    --tinta:#e8edf7; --tinta-fraca:#94a3b8; --tinta-tenue:#73839b;
    --azul:#2563eb; --azul-vivo:#3b82f6; --azul-brilho:rgba(37,99,235,.45);
    --verde:#22c55e; --verde-fundo:rgba(34,197,94,.12);
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body {
    margin:0; background:var(--breu); color:var(--tinta);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:17px; line-height:1.65; -webkit-font-smoothing:antialiased;
  }
  ::selection { background:var(--azul); color:#fff; }
  .env { width:100%; max-width:1120px; margin:0 auto; padding:0 24px; }
  .estreito { max-width:780px; }

  /* Malha tenue ao fundo do topo: da profundidade sem desenhar nada. */
  .malha {
    position:relative;
    background-image:linear-gradient(var(--borda) 1px,transparent 1px),linear-gradient(90deg,var(--borda) 1px,transparent 1px);
    background-size:56px 56px; background-position:center;
  }
  .malha::after {
    content:""; position:absolute; inset:0; pointer-events:none;
    background:radial-gradient(ellipse 70% 60% at 50% 0%,transparent 30%,var(--breu) 78%);
  }
  .malha > * { position:relative; z-index:1; }

  /* topo */
  .topo { border-bottom:1px solid var(--borda); background:rgba(8,11,20,.86); backdrop-filter:blur(10px); position:sticky; top:0; z-index:20; }
  .topo .env { display:flex; align-items:center; gap:34px; padding-top:15px; padding-bottom:15px; }
  .marca { display:flex; align-items:center; gap:11px; font-weight:700; font-size:20px; letter-spacing:-.02em; }
  .logo { height:29px; width:auto; display:block; }
  .rodape .logo { height:25px; }
  .menu { display:flex; gap:28px; margin-left:6px; }
  .menu a { color:var(--tinta-fraca); text-decoration:none; font-size:15px; }
  .menu a:hover { color:var(--tinta); }
  .topo .btn-topo { margin-left:auto; }

  /* botoes */
  .btn { display:inline-flex; align-items:center; gap:9px; border-radius:11px; font-weight:600; text-decoration:none; border:1px solid transparent; }
  .btn-primario {
    background:var(--azul); color:#fff; padding:17px 34px; font-size:17px;
    box-shadow:0 0 0 1px var(--azul-vivo), 0 14px 42px -10px var(--azul-brilho);
  }
  .btn-primario:hover { background:var(--azul-vivo); box-shadow:0 0 0 1px var(--azul-vivo), 0 16px 52px -8px var(--azul-brilho); }
  .btn-topo { background:var(--azul); color:#fff; padding:10px 20px; font-size:15px; white-space:nowrap; }
  .btn-topo:hover { background:var(--azul-vivo); }
  .acoes { display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-top:36px; }
  a:focus-visible, .btn:focus-visible { outline:2px solid var(--azul-vivo); outline-offset:3px; }

  /* Eyebrow: qualifica QUEM deve continuar lendo, nao descreve o produto. */
  .publico {
    display:inline-block; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:13px; letter-spacing:.16em; text-transform:uppercase;
    color:var(--azul-vivo); margin-bottom:26px;
  }
  .rotulo {
    display:inline-block; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:12px; letter-spacing:.15em; text-transform:uppercase;
    color:var(--azul-vivo); margin-bottom:20px;
  }

  /* secoes */
  section { padding:96px 0; }
  section.linhada { border-top:1px solid var(--borda); }
  section.painel { background:var(--painel); border-top:1px solid var(--borda); border-bottom:1px solid var(--borda); }
  h1 { font-size:clamp(40px,7vw,76px); line-height:1.03; letter-spacing:-.035em; margin:0 0 26px; font-weight:800; text-wrap:balance; }
  h2 { font-size:clamp(28px,4vw,44px); line-height:1.13; letter-spacing:-.028em; margin:0 0 18px; font-weight:750; text-wrap:balance; }
  h3 { font-size:19px; margin:0 0 9px; font-weight:650; letter-spacing:-.01em; }
  .chamada { font-size:clamp(18px,2.1vw,21px); color:var(--tinta-fraca); margin:0; max-width:660px; }

  /* Triade de negacao: nomeia tres objecoes em paralelo. */
  .triade { display:flex; flex-wrap:wrap; gap:10px 22px; margin:0; font-size:clamp(17px,2vw,20px); color:var(--tinta-fraca); }
  .triade span { display:inline-flex; align-items:center; gap:10px; }
  .triade span::before { content:""; width:5px; height:5px; border-radius:50%; background:var(--azul-vivo); flex:none; }

  /* Redutor de risco, colado no CTA. */
  .garantia { display:flex; align-items:center; gap:10px; font-size:15px; color:var(--tinta-fraca); margin-top:20px; }
  .garantia .tique { color:var(--verde); font-weight:700; }

  /* grades */
  .grade { display:grid; gap:20px; margin-top:46px; }
  .g2 { grid-template-columns:repeat(2,1fr); }
  .g3 { grid-template-columns:repeat(3,1fr); }
  .cartao { background:var(--painel); border:1px solid var(--borda); border-radius:15px; padding:28px; }
  section.painel .cartao { background:var(--painel-alto); }
  .cartao p { margin:0; color:var(--tinta-fraca); font-size:16px; }

  /* comparacao */
  .versus { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:46px; }
  .versus > div { border-radius:15px; padding:30px; border:1px solid var(--borda); }
  .antes { background:var(--painel); }
  .antes h3 { color:var(--tinta-fraca); }
  .depois { background:linear-gradient(160deg,#12306e,#0d1f4a); border-color:var(--azul); }
  .versus h3 { margin-bottom:17px; font-size:16px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.08em; text-transform:uppercase; }
  .versus ul { margin:0; padding-left:19px; }
  .versus li { margin-bottom:11px; font-size:16px; color:var(--tinta-fraca); }
  .depois li { color:#cbdcfa; }
  .depois li::marker { color:var(--azul-vivo); }

  /* demonstracao do chat */
  .telinha { background:var(--painel); border-radius:18px; padding:26px; margin-top:52px; border:1px solid var(--borda-forte); box-shadow:0 30px 80px -30px rgba(0,0,0,.9); }
  .bolha { max-width:78%; padding:13px 17px; border-radius:15px; margin-bottom:13px; font-size:16px; line-height:1.5; }
  .bolha.eu { background:var(--azul); color:#fff; margin-left:auto; border-bottom-right-radius:5px; }
  .bolha.ele { background:var(--painel-alto); color:var(--tinta); border:1px solid var(--borda); border-bottom-left-radius:5px; white-space:pre-line; }
  .telinha .aviso { color:var(--tinta-tenue); font-size:13px; margin:18px 0 0; text-align:center; }

  /* listas de exemplos */
  .perguntas { display:flex; flex-wrap:wrap; gap:11px; margin-top:38px; }
  .perguntas span { background:var(--painel-alto); border:1px solid var(--borda); border-radius:100px; padding:11px 19px; font-size:16px; color:var(--tinta-fraca); }

  /* integracoes */
  .conecta { display:grid; grid-template-columns:repeat(auto-fit,minmax(216px,1fr)); gap:16px; margin-top:42px; }
  .conecta div { border:1px solid var(--borda); border-radius:13px; padding:20px 22px; background:var(--painel-alto); }
  .conecta strong { display:block; font-size:15px; margin-bottom:5px; }
  .conecta small { color:var(--tinta-fraca); font-size:14px; line-height:1.5; }

  /* seguranca */
  .seguro { display:grid; gap:18px; margin-top:42px; }
  .seguro > div { display:flex; gap:16px; align-items:flex-start; }
  .seguro .marca-v { flex:0 0 26px; height:26px; border-radius:50%; background:var(--verde-fundo); color:var(--verde); display:grid; place-items:center; font-size:14px; font-weight:700; margin-top:3px; }
  .seguro strong { display:block; margin-bottom:3px; }
  .seguro p { margin:0; color:var(--tinta-fraca); font-size:16px; }

  /* fechamento */
  .fecha { text-align:center; background:radial-gradient(ellipse 80% 100% at 50% 100%,#10224a 0%,var(--breu) 70%); }
  .fecha .chamada { margin:0 auto; }
  .fecha .acoes { justify-content:center; }
  .fecha .garantia { justify-content:center; }

  .rodape { padding:38px 0; font-size:15px; color:var(--tinta-tenue); border-top:1px solid var(--borda); }
  .rodape .env { display:flex; flex-wrap:wrap; gap:16px; align-items:center; }
  .rodape a { color:var(--tinta-fraca); }
  .rodape .dir { margin-left:auto; }
  .legais { display:flex; flex-wrap:wrap; gap:8px 22px; margin-top:22px; padding-top:22px;
            border-top:1px solid var(--borda); width:100%; }
  .legais a { color:var(--tinta-tenue); text-decoration:none; font-size:14.5px; }
  .legais a:hover { color:var(--tinta-fraca); }

  @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
  @media (max-width:900px) {
    section { padding:68px 0; }
    .menu { display:none; }
    .g3, .g2, .versus { grid-template-columns:1fr; }
    .bolha { max-width:93%; }
    .rodape .dir { margin-left:0; width:100%; }
  }
</style></head>
<body>

<header class="topo">
  <div class="env">
    <div class="marca">__LOGO__ Kyrius</div>
    <nav class="menu">
      <a href="#diferenca">A diferença</a>
      <a href="#conecta">Integrações</a>
      <a href="#seguranca">Segurança</a>
    </nav>
    <!--CTA_TOPO-->
  </div>
</header>

<!-- ABERTURA -->
<section class="malha">
  <div class="env">
    <span class="publico">[ Para donos de pequenas e médias empresas ]</span>
    <h1>Plataforma de soluções de inteligência artificial para sua empresa</h1>
    <p class="triade">
      <span>Sem trocar de ferramenta.</span>
      <span>Sem treinar a equipe.</span>
      <span>Sem esperar relatório.</span>
    </p>
    <div class="acoes">
      <!--CTA-->
    </div>
  </div>
</section>

<!-- PROBLEMA -->
<section class="painel">
  <div class="env estreito">
    <h2>A informação existe. Ela só está espalhada.</h2>
    <p class="chamada">
      Seu financeiro está num sistema, seus clientes em outro, seus controles
      numa planilha. Cada resposta simples exige abrir três lugares e juntar
      de cabeça — e sempre na hora em que você está ocupado com outra coisa.
    </p>
    <div class="grade g3">
      <div class="cartao">
        <h3>Você vira o relatório</h3>
        <p>Toda pergunta sobre o próprio negócio passa por você, porque só você sabe onde cada coisa está.</p>
      </div>
      <div class="cartao">
        <h3>Descobre tarde</h3>
        <p>O cliente que parou de pagar aparece quando alguém lembra de conferir — raramente no dia em que atrasou.</p>
      </div>
      <div class="cartao">
        <h3>Sistema que ninguém usa</h3>
        <p>Você já pagou por ferramenta que a equipe abandonou porque exigia aprender mais uma tela.</p>
      </div>
    </div>
  </div>
</section>

<!-- DIFERENCIAL -->
<section id="diferenca">
  <div class="env">
    <span class="rotulo">[ O que muda ]</span>
    <h2>Não é automação. É alguém que entende o pedido.</h2>
    <p class="chamada">
      Ferramentas de automação executam um caminho que você configurou antes.
      Se a pergunta muda, o caminho não serve. O Kyrius interpreta o que você
      pediu e decide sozinho onde buscar.
    </p>
    <div class="versus">
      <div class="antes">
        <h3>Automação comum</h3>
        <ul>
          <li>Você configura o fluxo passo a passo, antes de precisar</li>
          <li>Faz exatamente aquilo, e só aquilo</li>
          <li>Pergunta nova exige montar um fluxo novo</li>
          <li>Não cruza informação entre sistemas</li>
          <li>Exige alguém técnico para manter</li>
        </ul>
      </div>
      <div class="depois">
        <h3>Kyrius</h3>
        <ul>
          <li>Você pergunta com as suas palavras, na hora</li>
          <li>Ele decide quais sistemas consultar</li>
          <li>Pergunta que você nunca fez também funciona</li>
          <li>Cruza dados de vários sistemas numa resposta</li>
          <li>Quem usa é você, não um analista</li>
        </ul>
      </div>
    </div>
    <div class="grade g2">
      <div class="cartao">
        <h3>Uma frase, vários sistemas</h3>
        <p><em>"Cadastra o cliente João Silva"</em> funciona igual, esteja o cadastro no CRM ou no financeiro. Você não precisa saber onde cada informação mora — nem lembrar o nome do campo.</p>
      </div>
      <div class="cartao">
        <h3>Responde como analista, não como busca</h3>
        <p>Em vez de devolver uma lista crua, ele soma, compara e aponta o que importa: quem é o maior atraso, o que mudou desde ontem, o que merece sua atenção hoje.</p>
      </div>
    </div>
  </div>
</section>

<!-- EXEMPLOS -->
<section class="painel">
  <div class="env">
    <h2>Coisas que você pode perguntar</h2>
    <p class="chamada">Sem comando, sem menu, sem treinamento. Escreva como escreveria para uma pessoa.</p>
    <div class="perguntas">
      <span>Quem está com boleto vencido?</span>
      <span>Quanto tenho pra receber esse mês?</span>
      <span>Quais boletos vencem essa semana?</span>
      <span>Qual o saldo das minhas contas?</span>
      <span>Quais orçamentos estão parados?</span>
      <span>Cadastra o cliente João Silva</span>
      <span>Quanto entrou de vendas ontem?</span>
      <span>Lê a planilha de estoque</span>
      <span>O que tenho na agenda amanhã?</span>
      <span>Manda um e-mail pro contador</span>
      <span>Marca reunião sexta às 14h</span>
      <span>O que você fez por mim essa semana?</span>
    </div>
  </div>
</section>

<!-- DEMONSTRACAO -->
<!-- Fica depois dos exemplos, e nao no topo: primeiro o leitor entende o que
     pode perguntar, depois ve como a resposta chega. No hero, a conversa
     aparecia antes de existir a pergunta que ela responde. -->
<section>
  <div class="env estreito">
    <span class="rotulo">[ Como é na prática ]</span>
    <h2>Uma conversa, não uma tela de sistema.</h2>
    <div class="telinha">
      <div class="bolha eu">quem está com boleto vencido?</div>
      <div class="bolha ele">Você tem 4 clientes em atraso, somando R$ 8.430,00:

• Comercial Souza — R$ 3.200,00 (12 dias)
• Mercearia Boa Vista — R$ 2.780,00 (8 dias)
• J. Ferreira ME — R$ 1.650,00 (5 dias)
• Auto Peças Lima — R$ 800,00 (2 dias)

O Comercial Souza é o mais antigo e o maior valor.</div>
      <div class="bolha eu">manda um e-mail de cobrança pro Souza</div>
      <div class="bolha ele">Vou enviar para financeiro@comercialsouza.com.br
lembrando do boleto de R$ 3.200,00, vencido há 12 dias.

Confirma o envio?</div>
      <p class="aviso">Exemplo ilustrativo. Nada é enviado ou alterado sem a sua confirmação.</p>
    </div>
  </div>
</section>

<!-- PROATIVO -->
<section>
  <div class="env">
    <span class="rotulo">[ Trabalha sem você pedir ]</span>
    <h2>Nem toda resposta deveria depender da pergunta.</h2>
    <div class="grade g2">
      <div class="cartao">
        <h3>Resumo diário por e-mail</h3>
        <p>Todo dia, no horário que você escolher, um resumo do que importa: quem entrou em atraso, o que vence hoje, quanto há a receber, o que mudou no CRM. Chega pronto, mesmo nos dias em que você não abre nada.</p>
      </div>
      <div class="cartao">
        <h3>Alertas quando algo muda</h3>
        <p>Você diz o que quer acompanhar — <em>"me avisa quando aparecer inadimplente novo"</em> — e o Kyrius verifica sozinho, avisando só quando há mudança de verdade. Sem aviso repetido, sem ruído.</p>
      </div>
    </div>
  </div>
</section>

<!-- INTEGRACOES -->
<section id="conecta" class="painel">
  <div class="env">
    <h2>Conecta no que você já usa</h2>
    <p class="chamada">
      O Kyrius não substitui seus sistemas — ele conversa com eles. Você
      continua trabalhando do mesmo jeito; muda só como pergunta.
    </p>
    <div class="conecta">
      <div><strong>Asaas</strong><small>Cobranças, boletos, inadimplência e contas a receber</small></div>
      <div><strong>HubSpot</strong><small>Clientes, contatos, orçamentos e vendas em aberto</small></div>
      <div><strong>Google</strong><small>Gmail, Agenda e Planilhas do Google</small></div>
      <div><strong>Stripe</strong><small>Recebimentos, saldo e pagamentos online</small></div>
      <div><strong>Mercado Pago</strong><small>Pagamentos recebidos e detalhamento</small></div>
      <div><strong>Pagar.me</strong><small>Pedidos, pagamentos e clientes</small></div>
      <div><strong>Contas bancárias</strong><small>Saldo e extrato via Open Finance</small></div>
      <div><strong>Instagram</strong><small>Métricas e desempenho da conta</small></div>
      <div><strong>Suas planilhas</strong><small>Envie um Excel ou CSV no chat e pergunte sobre ele</small></div>
    </div>
  </div>
</section>

<!-- SEGURANCA -->
<section id="seguranca">
  <div class="env estreito">
    <span class="rotulo">[ Segurança ]</span>
    <h2>Você está confiando dados financeiros. Isso pesa.</h2>
    <p class="chamada">
      Não dá para pedir acesso ao seu CRM e ao seu financeiro e tratar
      segurança como detalhe. Aqui está exatamente como funciona.
    </p>
    <div class="seguro">
      <div>
        <span class="marca-v">✓</span>
        <div>
          <strong>Nada é alterado sem você confirmar</strong>
          <p>Consultar é livre. Mas antes de cadastrar, alterar ou enviar qualquer coisa, o Kyrius descreve o que vai fazer e espera você autorizar. Não existe caminho em que ele age por conta própria.</p>
        </div>
      </div>
      <div>
        <span class="marca-v">✓</span>
        <div>
          <strong>Suas chaves ficam criptografadas</strong>
          <p>As credenciais de acesso aos seus sistemas são guardadas cifradas. Você as cadastra numa tela sua, nunca por conversa ou e-mail.</p>
        </div>
      </div>
      <div>
        <span class="marca-v">✓</span>
        <div>
          <strong>Você conecta e desconecta quando quiser</strong>
          <p>Cada sistema é autorizado por você, individualmente, e revogado do mesmo jeito — sem depender de ninguém e sem prazo de carência.</p>
        </div>
      </div>
      <div>
        <span class="marca-v">✓</span>
        <div>
          <strong>Toda operação fica registrada</strong>
          <p>Tudo que o Kyrius consulta ou executa vai para um histórico auditável. Você pode perguntar, no próprio chat, o que foi feito e quando.</p>
        </div>
      </div>
      <div>
        <span class="marca-v">✓</span>
        <div>
          <strong>Seus dados são só seus</strong>
          <p>Cada empresa tem seu espaço isolado. Seus dados não são usados para nada além de responder a você.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- COMO COMECA -->
<section class="painel">
  <div class="env">
    <h2>Como começa</h2>
    <div class="grade g3">
      <div class="cartao">
        <h3>1. Conversamos</h3>
        <p>Entendo o que você usa hoje e onde perde tempo. Se o Kyrius não ajudar no seu caso, eu falo na hora.</p>
      </div>
      <div class="cartao">
        <h3>2. Conecto com você</h3>
        <p>Cerca de 40 minutos para autorizar os sistemas e configurar o resumo diário. Você não instala nada.</p>
      </div>
      <div class="cartao">
        <h3>3. Você usa e me diz</h3>
        <p>A partir daí funciona no navegador, do celular ou do computador. Suporte direto comigo.</p>
      </div>
    </div>
  </div>
</section>

<!-- FECHAMENTO -->
<section class="fecha linhada">
  <div class="env estreito">
    <h2>Veja funcionando com os seus dados</h2>
    <p class="chamada">
      Uma conversa curta, sem compromisso. Se não fizer sentido para a sua
      operação, eu mesmo digo.
    </p>
    <div class="acoes">
      <!--CTA-->
    </div>
    <p class="garantia"><span class="tique">✓</span> Sem contrato de fidelidade. Sem cartão de crédito para conversar.</p>
  </div>
</section>

<footer class="rodape">
  <div class="env">
    <div class="marca">__LOGO__ Kyrius</div>
    <a href="mailto:<!--EMAIL-->"><!--EMAIL--></a>
    <span class="dir">Assistente de IA para pequenas e médias empresas</span>

    <nav class="legais" aria-label="Documentos institucionais">
      <a href="/privacidade">Política de Privacidade</a>
      <a href="/termos">Termos de Uso</a>
      <a href="/seguranca">Segurança da Informação</a>
      <a href="/acessibilidade">Acessibilidade</a>
    </nav>
  </div>
</footer>

</body></html>`.replace(/__LOGO__/g, LandingController.LOGO);
}
