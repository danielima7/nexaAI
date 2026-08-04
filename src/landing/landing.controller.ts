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
        'Olá! Vi o site do Kyrius e queria agendar uma demonstração.',
      );
      const email =
        this.config.get<string>('KYRIUS_CONTATO_EMAIL') ??
        'contato@kyrius.com.br';

      // Sem WhatsApp configurado, o botao cai no e-mail em vez de sumir: uma
      // landing sem caminho de contato e so uma pagina bonita.
      const destino = zap
        ? `href="${zap}" target="_blank" rel="noopener noreferrer"`
        : `href="mailto:${email}?subject=Demonstra%C3%A7%C3%A3o%20do%20Kyrius"`;

      const cta = `<a class="btn btn-primario" ${destino}>Agendar uma demonstração</a>`;

      this.paginaCache = LandingController.HTML.replace(
        /<!--CTA-->/g,
        cta,
      ).replace(/<!--EMAIL-->/g, email);
    }

    return this.paginaCache;
  }

  /**
   * Simbolo da marca, embutido como SVG.
   *
   * Inline, e nao como arquivo: a pagina continua sem nenhuma requisicao
   * externa, carrega em uma viagem so no 4G do cliente e nao quebra se um
   * caminho de asset mudar no deploy. O gradiente acompanha a paleta azul.
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
  /* Azul como cor da marca: para quem vai autorizar acesso ao proprio
     financeiro, azul comunica estabilidade melhor do que qualquer outra
     familia de cor. O fundo neutro levemente frio acompanha, sem virar o
     branco puro que deixa a leitura dura em tela de celular ao sol. */
  :root {
    --tinta:#111827; --tinta-fraca:#4b5563; --linha:#e2e8f0;
    --fundo:#f8fafc; --papel:#ffffff; --azul:#1d4ed8; --azul-fundo:#dbeafe;
    --verde:#166534; --verde-claro:#dcfce7; --escuro:#0f172a; --escuro-painel:#1e293b;
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body {
    margin:0; background:var(--fundo); color:var(--tinta);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:17px; line-height:1.65; -webkit-font-smoothing:antialiased;
  }
  .env { width:100%; max-width:1080px; margin:0 auto; padding:0 24px; }
  .estreito { max-width:760px; }

  /* topo */
  .topo { padding:18px 0; border-bottom:1px solid var(--linha); background:var(--papel); }
  .topo .env { display:flex; align-items:center; }
  .marca { display:flex; align-items:center; gap:11px; font-weight:700; font-size:20px; letter-spacing:-.02em; }
  .logo { height:30px; width:auto; display:block; }
  .rodape .logo { height:26px; }

  /* botoes */
  .btn { display:inline-block; padding:15px 30px; border-radius:11px; font-weight:600; font-size:17px; text-decoration:none; border:1px solid transparent; }
  .btn-primario { background:var(--azul); color:#fff; }
  .btn-primario:hover { background:#1e3a8a; }
  .acoes { display:flex; flex-wrap:wrap; gap:12px; margin-top:32px; }

  /* secoes */
  section { padding:88px 0; }
  section.papel { background:var(--papel); border-top:1px solid var(--linha); border-bottom:1px solid var(--linha); }
  h1 { font-size:clamp(34px,5.2vw,54px); line-height:1.12; letter-spacing:-.03em; margin:0 0 22px; font-weight:800; }
  h2 { font-size:clamp(26px,3.4vw,36px); line-height:1.2; letter-spacing:-.02em; margin:0 0 18px; font-weight:750; }
  h3 { font-size:19px; margin:0 0 8px; font-weight:650; letter-spacing:-.01em; }
  .chamada { font-size:clamp(18px,2.1vw,21px); color:var(--tinta-fraca); margin:0; max-width:640px; }
  .rotulo { display:inline-block; font-size:13px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:var(--azul); background:var(--azul-fundo); padding:6px 13px; border-radius:100px; margin-bottom:22px; }

  /* grades */
  .grade { display:grid; gap:22px; margin-top:44px; }
  .g2 { grid-template-columns:repeat(2,1fr); }
  .g3 { grid-template-columns:repeat(3,1fr); }
  .cartao { background:var(--papel); border:1px solid var(--linha); border-radius:15px; padding:28px; }
  section.papel .cartao { background:var(--fundo); }
  .cartao p { margin:0; color:var(--tinta-fraca); font-size:16px; }

  /* comparacao */
  .versus { display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-top:44px; }
  .versus > div { border-radius:15px; padding:30px; border:1px solid var(--linha); }
  .antes { background:var(--papel); }
  .depois { background:var(--azul); color:#fff; border-color:var(--azul); }
  .depois h3, .depois li { color:#fff; }
  .versus h3 { margin-bottom:16px; font-size:17px; }
  .versus ul { margin:0; padding-left:20px; }
  .versus li { margin-bottom:11px; font-size:16px; color:var(--tinta-fraca); }
  .depois li { color:#dbeafe; }

  /* demonstracao do chat */
  .telinha { background:var(--escuro); border-radius:17px; padding:26px; margin-top:44px; border:1px solid #2b3444; }
  .bolha { max-width:76%; padding:13px 17px; border-radius:15px; margin-bottom:13px; font-size:16px; line-height:1.5; }
  .bolha.eu { background:#2563eb; color:#fff; margin-left:auto; border-bottom-right-radius:5px; }
  .bolha.ele { background:var(--escuro-painel); color:#e5e7eb; border-bottom-left-radius:5px; white-space:pre-line; }
  .telinha .aviso { color:#9ca3af; font-size:13px; margin:18px 0 0; text-align:center; }

  /* listas de exemplos */
  .perguntas { display:flex; flex-wrap:wrap; gap:11px; margin-top:36px; }
  .perguntas span { background:var(--papel); border:1px solid var(--linha); border-radius:100px; padding:11px 19px; font-size:16px; color:var(--tinta-fraca); }
  section.papel .perguntas span { background:var(--fundo); }

  /* integracoes */
  .conecta { display:grid; grid-template-columns:repeat(auto-fit,minmax(215px,1fr)); gap:18px; margin-top:40px; }
  .conecta div { border:1px solid var(--linha); border-radius:13px; padding:20px 22px; background:var(--papel); }
  section.papel .conecta div { background:var(--fundo); }
  .conecta strong { display:block; font-size:15px; margin-bottom:5px; }
  .conecta small { color:var(--tinta-fraca); font-size:14px; line-height:1.5; }

  /* seguranca */
  .seguro { display:grid; gap:18px; margin-top:40px; }
  .seguro > div { display:flex; gap:16px; align-items:flex-start; }
  .seguro .marca-v { flex:0 0 27px; height:27px; border-radius:50%; background:var(--verde-claro); color:var(--verde); display:grid; place-items:center; font-size:15px; font-weight:700; margin-top:2px; }
  .seguro strong { display:block; margin-bottom:3px; }
  .seguro p { margin:0; color:var(--tinta-fraca); font-size:16px; }

  /* fechamento */
  .fecha { background:var(--escuro); color:#fff; text-align:center; }
  .fecha h2 { color:#fff; }
  .fecha .chamada { color:#9ca3af; margin:0 auto; }
  .fecha .acoes { justify-content:center; }

  .rodape { padding:36px 0; font-size:15px; color:var(--tinta-fraca); background:var(--papel); border-top:1px solid var(--linha); }
  .rodape .env { display:flex; flex-wrap:wrap; gap:16px; align-items:center; }
  .rodape a { color:var(--tinta-fraca); }
  .rodape .dir { margin-left:auto; }

  @media (max-width:860px) {
    section { padding:64px 0; }
    .g3, .g2, .versus { grid-template-columns:1fr; }
    .bolha { max-width:92%; }
    .rodape .dir { margin-left:0; width:100%; }
  }
</style></head>
<body>

<header class="topo">
  <div class="env">
    <div class="marca">__LOGO__ Kyrius</div>
  </div>
</header>

<!-- ABERTURA -->
<section>
  <div class="env">
    <span class="rotulo">Assistente de IA para a sua empresa</span>
    <h1>Pergunte em português.<br/>Sem abrir sistema nenhum.</h1>
    <p class="chamada">
      Quem está devendo, o que vence essa semana, o que aconteceu no CRM.
      Você escreve como falaria com um funcionário, e a resposta vem em
      segundos — do celular ou do computador.
    </p>
    <div class="acoes">
      <!--CTA-->
    </div>

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

<!-- PROBLEMA -->
<section class="papel">
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
<section>
  <div class="env">
    <span class="rotulo">O que muda</span>
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
<section class="papel">
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

<!-- PROATIVO -->
<section>
  <div class="env">
    <span class="rotulo">Trabalha sem você pedir</span>
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
<section class="papel">
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
<section>
  <div class="env estreito">
    <span class="rotulo">Segurança</span>
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
<section class="papel">
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
<section class="fecha">
  <div class="env estreito">
    <h2>Veja funcionando com os seus dados</h2>
    <p class="chamada">
      Uma conversa curta, sem compromisso. Se não fizer sentido para a sua
      operação, eu mesmo digo.
    </p>
    <div class="acoes">
      <!--CTA-->
    </div>
  </div>
</section>

<footer class="rodape">
  <div class="env">
    <div class="marca">__LOGO__ Kyrius</div>
    <a href="mailto:<!--EMAIL-->"><!--EMAIL--></a>
    <span class="dir">Assistente de IA para pequenas e médias empresas</span>
  </div>
</footer>

</body></html>`.replace(/__LOGO__/g, LandingController.LOGO);
}
