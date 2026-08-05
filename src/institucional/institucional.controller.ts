import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SuporteService } from '../suporte/suporte.service';

/**
 * Paginas institucionais: privacidade, termos, seguranca e acessibilidade.
 *
 * Servidas pelo proprio backend, no mesmo dominio do produto — documento
 * juridico hospedado em endereco de terceiro levanta a duvida errada
 * exatamente em quem esta decidindo se confia dados financeiros a voce.
 *
 * ⚠️ PRIVACIDADE e TERMOS sao rascunhos tecnicos, escritos a partir do que o
 * sistema realmente faz. Eles NAO substituem revisao juridica: o Kyrius trata
 * dados de terceiros como operador (LGPD art. 5, VII) e toca em informacao
 * financeira. Revise com advogado antes do primeiro cliente pagante.
 *
 * SEGURANCA e ACESSIBILIDADE descrevem comportamento verificavel do codigo.
 * Se alguma pratica mudar, esta pagina precisa mudar junto — pagina de
 * seguranca desatualizada e pior que pagina nenhuma, porque vira promessa
 * falsa por escrito.
 */
@Controller()
export class InstitucionalController {
  /** Data de vigencia exibida nos documentos. */
  private static readonly VIGENCIA = '5 de agosto de 2026';

  constructor(
    private readonly config: ConfigService,
    private readonly suporte: SuporteService,
  ) {}

  @Get('privacidade')
  privacidade(@Res() res: Response): void {
    this.enviar(res, 'Política de Privacidade', this.conteudoPrivacidade());
  }

  @Get('termos')
  termos(@Res() res: Response): void {
    this.enviar(res, 'Termos de Uso', this.conteudoTermos());
  }

  @Get('seguranca')
  seguranca(@Res() res: Response): void {
    this.enviar(res, 'Segurança da Informação', this.conteudoSeguranca());
  }

  @Get('acessibilidade')
  acessibilidade(@Res() res: Response): void {
    this.enviar(res, 'Acessibilidade', this.conteudoAcessibilidade());
  }

  // ---------------------------------------------------------------- helpers

  private dado(chave: string, rotulo: string): string {
    const valor = this.config.get<string>(chave)?.trim();
    // Pendencia visivel de proposito: um documento legal sem CNPJ e
    // incompleto, e o jeito mais confiavel de nao esquecer e a falta aparecer
    // na propria pagina.
    return valor || `<mark class="pendente">[preencher ${rotulo}]</mark>`;
  }

  private get email(): string {
    return (
      this.config.get<string>('KYRIUS_CONTATO_EMAIL') ?? 'contato@kyrius.com'
    );
  }

  private enviar(res: Response, titulo: string, corpo: string): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      InstitucionalController.LAYOUT.replace(/__TITULO__/g, titulo)
        .replace(/__CORPO__/g, corpo)
        .replace(/__VIGENCIA__/g, InstitucionalController.VIGENCIA)
        .replace(/__EMAIL__/g, this.email)
        .replace(
          /__WHATSAPP__/g,
          this.suporte.link('Olá! Tenho uma dúvida sobre privacidade e dados.') ??
            `mailto:${this.email}`,
        ),
    );
  }

  // --------------------------------------------------------------- conteudos

  private conteudoPrivacidade(): string {
    return `
<h2>Quem somos</h2>
<p>
  O Kyrius é operado por ${this.dado('KYRIUS_RAZAO_SOCIAL', 'razão social')},
  CNPJ ${this.dado('KYRIUS_CNPJ', 'CNPJ')}, com sede em
  ${this.dado('KYRIUS_ENDERECO', 'endereço')}.
</p>
<p>
  Para dúvidas sobre dados pessoais, fale com
  <a href="mailto:__EMAIL__">__EMAIL__</a>.
</p>

<h2>Nosso papel: controlador e operador</h2>
<p>
  A distinção importa e muda os seus direitos:
</p>
<ul>
  <li>
    <strong>Somos controladores</strong> dos dados da sua conta — nome,
    e-mail, empresa. Nós decidimos como tratá-los.
  </li>
  <li>
    <strong>Somos operadores</strong> dos dados que o Kyrius acessa nos
    sistemas que você conecta (clientes, cobranças, e-mails, planilhas). Esses
    dados são seus; nós apenas os consultamos, sob sua instrução, para
    responder ao que você pergunta.
  </li>
</ul>

<h2>O que coletamos</h2>
<table>
  <thead><tr><th>Dado</th><th>Para quê</th></tr></thead>
  <tbody>
    <tr><td>Nome, e-mail e nome da empresa</td><td>Identificar sua conta e falar com você</td></tr>
    <tr><td>Senha</td><td>Guardada apenas como <em>hash</em> (scrypt). Não temos como lê-la</td></tr>
    <tr><td>Mensagens do chat</td><td>Manter o contexto da conversa e responder</td></tr>
    <tr><td>Credenciais das integrações</td><td>Acessar seus sistemas. Guardadas <strong>criptografadas</strong></td></tr>
    <tr><td>Registro de operações</td><td>Auditoria — o que foi consultado ou executado, e quando</td></tr>
    <tr><td>Consumo de processamento</td><td>Medir uso e custo do serviço</td></tr>
  </tbody>
</table>
<p>
  Os dados que estão nos seus sistemas conectados <strong>não são copiados
  para o nosso banco</strong>. Eles são consultados no momento da pergunta e
  usados para compor a resposta.
</p>

<h2>Com quem compartilhamos</h2>
<p>Apenas com quem é necessário para o serviço funcionar:</p>
<ul>
  <li>
    <strong>Anthropic (Claude)</strong> — o conteúdo das suas mensagens e os
    resultados das consultas são enviados ao modelo de IA para gerar a
    resposta. É o núcleo do produto, e você deve saber disso.
  </li>
  <li>
    <strong>Os sistemas que você conecta</strong> — Google, HubSpot, Asaas,
    Stripe e demais, quando você autoriza cada um.
  </li>
  <li>
    <strong>Infraestrutura de hospedagem</strong>, para manter o serviço no ar.
  </li>
</ul>
<p>
  Não vendemos seus dados, não os usamos para publicidade e não os usamos para
  treinar modelos de IA.
</p>

<h2>Por quanto tempo guardamos</h2>
<ul>
  <li><strong>Conta e integrações</strong>: enquanto durar o contrato.</li>
  <li><strong>Histórico de conversa</strong>: mantido para dar contexto às respostas; pode ser apagado a pedido.</li>
  <li><strong>Registros de auditoria</strong>: mantidos mesmo após o encerramento, pelo prazo legal, porque servem justamente para comprovar o que foi feito.</li>
</ul>
<p>Ao encerrar a conta, credenciais e dados de acesso são excluídos.</p>

<h2>Seus direitos (LGPD)</h2>
<p>
  Você pode, a qualquer momento, pedir confirmação de tratamento, acesso,
  correção, anonimização, portabilidade ou exclusão dos seus dados, além de
  revogar consentimentos. Escreva para
  <a href="mailto:__EMAIL__">__EMAIL__</a> — respondemos em até 15 dias.
</p>
<p>
  Você também pode <strong>desconectar qualquer integração sozinho</strong>,
  pela tela de integrações, sem depender de nós. A revogação é imediata.
</p>

<h2>Transferência internacional</h2>
<p>
  O processamento de linguagem natural ocorre em servidores da Anthropic, e
  parte da infraestrutura pode estar fora do Brasil. A LGPD permite essa
  transferência quando necessária à execução do contrato — é o caso aqui, já
  que sem ela o produto não funciona.
</p>

<h2>Alterações</h2>
<p>
  Mudanças relevantes serão comunicadas por e-mail antes de entrarem em vigor.
</p>`;
  }

  private conteudoTermos(): string {
    return `
<h2>1. O que é o Kyrius</h2>
<p>
  O Kyrius é um assistente de inteligência artificial que consulta e opera, sob
  sua instrução, os sistemas que você conecta a ele. Ele <strong>não substitui
  </strong> esses sistemas: é uma camada de conversa sobre eles.
</p>
<p>
  Serviço prestado por ${this.dado('KYRIUS_RAZAO_SOCIAL', 'razão social')},
  CNPJ ${this.dado('KYRIUS_CNPJ', 'CNPJ')}.
</p>

<h2>2. Conta e responsabilidade de acesso</h2>
<ul>
  <li>Você é responsável por manter sua senha em sigilo e pelo que for feito com sua conta.</li>
  <li>Os dados informados no cadastro devem ser verdadeiros.</li>
  <li>Avise-nos imediatamente se suspeitar de acesso indevido.</li>
</ul>

<h2>3. Como funcionam as ações</h2>
<p>
  <strong>Consultar é livre. Alterar exige sua confirmação.</strong> Antes de
  cadastrar, alterar ou enviar qualquer coisa em um sistema conectado, o
  Kyrius descreve o que fará e aguarda sua autorização explícita.
</p>
<p>
  Ao confirmar, você assume a responsabilidade pela ação — como assumiria se a
  tivesse executado diretamente no sistema de origem.
</p>

<h2>4. Uso aceitável</h2>
<p>Você concorda em não usar o Kyrius para:</p>
<ul>
  <li>Atividade ilícita ou que viole direitos de terceiros;</li>
  <li>Acessar dados de pessoas ou empresas sem autorização;</li>
  <li>Tentar burlar limites, obter acesso indevido ou sobrecarregar o serviço;</li>
  <li>Revender ou repassar o acesso sem acordo prévio.</li>
</ul>

<h2>5. Limites da inteligência artificial</h2>
<p>
  O Kyrius usa modelos de linguagem, que <strong>podem cometer erros</strong>:
  interpretar mal um pedido, somar errado ou apresentar informação incompleta.
</p>
<p>
  As respostas são <strong>apoio à decisão, não aconselhamento</strong>
  contábil, jurídico ou financeiro. Confira informações críticas na fonte antes
  de agir — especialmente valores, prazos e dados fiscais.
</p>

<h2>6. Disponibilidade</h2>
<p>
  Trabalhamos para manter o serviço no ar, mas ele pode ficar indisponível por
  manutenção, falha de terceiros ou causas fora do nosso controle. Salvo acordo
  específico por escrito, <strong>não há SLA de disponibilidade contratado</strong>.
</p>
<p>
  O Kyrius depende de serviços de terceiros (provedores de IA e as
  integrações). Indisponibilidade neles afeta o Kyrius.
</p>

<h2>7. Preço e pagamento</h2>
<p>
  Valores, forma e periodicidade são os definidos na proposta comercial aceita
  por você. Contas em período de avaliação podem ter limites de uso, informados
  na contratação.
</p>

<h2>8. Encerramento</h2>
<p>
  Você pode encerrar quando quiser, sem multa, salvo condição diferente
  acordada por escrito. Podemos encerrar em caso de violação destes termos ou
  de inadimplência, com aviso prévio.
</p>
<p>
  Encerrada a conta, você pode solicitar seus dados antes da exclusão.
</p>

<h2>9. Propriedade</h2>
<p>
  O software e a marca Kyrius são nossos. <strong>Seus dados continuam seus</strong>
  — não adquirimos direito sobre as informações dos seus sistemas.
</p>

<h2>10. Limitação de responsabilidade</h2>
<p>
  Na máxima extensão permitida em lei, nossa responsabilidade fica limitada ao
  valor pago pelo serviço nos 12 meses anteriores ao evento. Não respondemos
  por lucros cessantes ou danos indiretos.
</p>
<p>
  Isto não afasta responsabilidade por dolo, culpa grave ou o que a lei
  brasileira não permita limitar.
</p>

<h2>11. Foro</h2>
<p>
  Aplica-se a lei brasileira. Fica eleito o foro da comarca de
  ${this.dado('KYRIUS_COMARCA', 'comarca — cidade/UF')} para dirimir
  controvérsias decorrentes destes termos.
</p>`;
  }

  private conteudoSeguranca(): string {
    return `
<h2>Credenciais das integrações</h2>
<p>
  As chaves de acesso aos seus sistemas são gravadas <strong>criptografadas com
  AES-256-GCM</strong>, com vetor de inicialização próprio por registro e tag de
  autenticação — que detecta adulteração, não só protege a leitura.
</p>
<p>
  A chave de criptografia fica fora do banco. Sem ela, o conteúdo é ilegível
  mesmo para quem tiver o arquivo do banco em mãos. O sistema é
  <em>fail-closed</em>: sem a chave configurada, ele <strong>recusa gravar</strong>
  em vez de salvar em texto aberto.
</p>

<h2>Senhas</h2>
<p>
  Senhas nunca são armazenadas. Guardamos apenas o resultado de
  <strong>scrypt</strong>, algoritmo desenhado para ser caro de quebrar por
  força bruta. Não temos como recuperar sua senha — só redefini-la.
</p>

<h2>Sessão e autenticação</h2>
<ul>
  <li>Token de sessão assinado com <strong>HMAC-SHA256</strong>, válido por 12 horas.</li>
  <li>A identidade vem do token assinado pelo servidor, nunca do que o navegador informa.</li>
  <li>Limite de <strong>8 tentativas de login a cada 15 minutos</strong> por origem.</li>
</ul>

<h2>Nada é alterado sem confirmação</h2>
<p>
  Toda ferramenta que cria ou altera dado é marcada como escrita. A primeira
  chamada <strong>não executa nada</strong>: devolve a descrição do que seria
  feito e aguarda confirmação explícita. Não existe caminho em que a IA altere
  seus sistemas por conta própria.
</p>

<h2>Separação entre empresas</h2>
<p>
  Cada organização enxerga apenas os próprios dados e as próprias integrações.
  A verificação acontece <strong>na execução</strong>, não apenas na exibição:
  uma ferramenta fora do escopo é recusada mesmo se chamada diretamente pelo
  nome. Isso protege contra erro do modelo e contra tentativas de manipulação
  por texto.
</p>

<h2>Auditoria</h2>
<p>
  Toda execução é registrada — inclusive as recusadas e as que ficaram
  aguardando confirmação — com data, ferramenta, argumentos e resultado. Você
  pode consultar esse histórico pelo próprio chat.
</p>

<h2>Transporte e infraestrutura</h2>
<ul>
  <li>Todo o tráfego é servido sobre <strong>HTTPS</strong>, com certificado renovado automaticamente e HSTS habilitado.</li>
  <li>O banco de dados <strong>não é exposto à internet</strong>: só a aplicação o alcança, pela rede interna.</li>
  <li>A aplicação roda como usuário sem privilégios administrativos.</li>
</ul>

<h2>Chaves e segredos</h2>
<p>
  Credenciais de sistema ficam em variáveis de ambiente, fora do código e fora
  do controle de versão. Chaves de API nunca devem ser enviadas por conversa —
  existe uma tela própria para cadastrá-las, e é ela que preserva a
  criptografia.
</p>

<h2>O que ainda não temos</h2>
<p>
  Sendo honesto sobre os limites atuais, porque isso também é informação de
  segurança:
</p>
<ul>
  <li>Não possuímos certificações formais (ISO 27001, SOC 2).</li>
  <li>Não passamos por teste de intrusão independente.</li>
  <li>Não há autenticação em duas etapas no acesso ao chat.</li>
  <li>Operamos em região única, sem redundância geográfica.</li>
</ul>
<p>
  Se você encontrar uma falha de segurança, escreva para
  <a href="mailto:__EMAIL__">__EMAIL__</a>. Levamos a sério e respondemos.
</p>`;
  }

  private conteudoAcessibilidade(): string {
    return `
<h2>Nosso compromisso</h2>
<p>
  O Kyrius deve ser utilizável por qualquer pessoa, inclusive quem usa leitor
  de tela, navega apenas pelo teclado ou precisa de texto ampliado. Buscamos
  conformidade com as <strong>WCAG 2.1, nível AA</strong>.
</p>

<h2>O que já está implementado</h2>
<ul>
  <li>
    <strong>Contraste verificado.</strong> Todas as combinações de texto e
    fundo foram medidas e atingem no mínimo 4,5:1 — a maioria fica bem acima.
  </li>
  <li>
    <strong>Navegação por teclado.</strong> Todos os controles são alcançáveis
    por <kbd>Tab</kbd>, e o elemento em foco recebe contorno visível.
  </li>
  <li>
    <strong>Estrutura semântica.</strong> Títulos em hierarquia, listas e
    tabelas reais — o que permite ao leitor de tela navegar por seções em vez
    de ler tudo em sequência.
  </li>
  <li>
    <strong>Textos alternativos</strong> em elementos gráficos.
  </li>
  <li>
    <strong>Informação nunca depende só de cor.</strong> Todo aviso tem texto
    correspondente.
  </li>
  <li>
    <strong>Responsivo</strong>, sem rolagem horizontal, e legível com zoom.
  </li>
  <li>
    <strong>Movimento reduzido</strong> é respeitado quando configurado no
    sistema operacional.
  </li>
  <li>
    <strong>A conversa é o modo principal de uso</strong>, o que já favorece
    quem tem dificuldade com interfaces densas: não é preciso caçar menus.
  </li>
</ul>

<h2>Limitações conhecidas</h2>
<p>Sendo transparentes sobre o que ainda falta:</p>
<ul>
  <li>Não realizamos auditoria de acessibilidade por especialista independente.</li>
  <li>O chat não anuncia automaticamente novas mensagens para leitores de tela.</li>
  <li>Planilhas enviadas são lidas como texto; arquivos com estrutura complexa podem perder formatação.</li>
</ul>

<h2>Encontrou uma barreira?</h2>
<p>
  Isso é um defeito, e queremos corrigir. Escreva para
  <a href="mailto:__EMAIL__">__EMAIL__</a> ou fale
  <a href="__WHATSAPP__" target="_blank" rel="noopener noreferrer">pelo WhatsApp</a>,
  descrevendo o que tentou fazer e o que aconteceu. Respondemos em até 5 dias
  úteis com um prazo de correção.
</p>`;
  }

  // ----------------------------------------------------------------- layout

  private static readonly LAYOUT = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>__TITULO__ — Kyrius</title>
<style>
  :root {
    --breu:#080b14; --painel:#0f1729; --borda:#1e2a44;
    --tinta:#e8edf7; --tinta-fraca:#94a3b8; --azul:#2563eb; --azul-vivo:#3b82f6;
    --alerta:#fbbf24;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--breu); color:var(--tinta); font-size:17px; line-height:1.7;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .topo { border-bottom:1px solid var(--borda); padding:18px 0; }
  .env { width:100%; max-width:760px; margin:0 auto; padding:0 24px; }
  .marca { display:flex; align-items:center; gap:10px; font-weight:700; font-size:19px;
           color:var(--tinta); text-decoration:none; letter-spacing:-.02em; }
  .marca .selo { width:30px; height:30px; border-radius:8px; background:var(--azul);
                 display:grid; place-items:center; font-size:15px; }
  main { padding:56px 0 80px; }
  h1 { font-size:clamp(30px,5vw,42px); line-height:1.15; letter-spacing:-.03em; margin:0 0 10px; font-weight:800; }
  .vigencia { color:var(--tinta-fraca); font-size:15px; margin:0 0 40px; }
  h2 { font-size:21px; margin:44px 0 12px; letter-spacing:-.015em; font-weight:700; }
  p { margin:0 0 16px; }
  ul { margin:0 0 16px; padding-left:22px; }
  li { margin-bottom:9px; }
  a { color:var(--azul-vivo); }
  a:focus-visible, .marca:focus-visible { outline:2px solid var(--azul-vivo); outline-offset:3px; }
  strong { color:#fff; }
  kbd { background:var(--painel); border:1px solid var(--borda); border-radius:5px;
        padding:1px 6px; font-size:14px; font-family:ui-monospace,monospace; }
  table { width:100%; border-collapse:collapse; margin:0 0 20px; display:block; overflow-x:auto; }
  th, td { text-align:left; padding:11px 14px; border-bottom:1px solid var(--borda); font-size:16px; }
  th { color:var(--tinta-fraca); font-weight:600; font-size:14px; text-transform:uppercase; letter-spacing:.05em; }
  .aviso { background:var(--painel); border:1px solid var(--borda); border-left:3px solid var(--alerta);
           border-radius:0 10px 10px 0; padding:16px 20px; color:var(--tinta-fraca); font-size:16px; }
  .pendente { background:var(--alerta); color:#000; padding:1px 7px; border-radius:5px; font-weight:600; }
  .rodape { border-top:1px solid var(--borda); padding:28px 0; }
  .rodape .env { display:flex; flex-wrap:wrap; gap:20px; font-size:15px; }
  .rodape a { color:var(--tinta-fraca); text-decoration:none; }
  .rodape a:hover { color:var(--tinta); }
  @media (prefers-reduced-motion:reduce) { * { animation:none !important; transition:none !important; } }
</style></head>
<body>
  <header class="topo">
    <div class="env">
      <a class="marca" href="/"><span class="selo">K</span> Kyrius</a>
    </div>
  </header>

  <main>
    <div class="env">
      <h1>__TITULO__</h1>
      <p class="vigencia">Em vigor desde __VIGENCIA__</p>
      __CORPO__
    </div>
  </main>

  <footer class="rodape">
    <div class="env">
      <a href="/">Início</a>
      <a href="/privacidade">Privacidade</a>
      <a href="/termos">Termos de uso</a>
      <a href="/seguranca">Segurança</a>
      <a href="/acessibilidade">Acessibilidade</a>
      <a href="mailto:__EMAIL__">__EMAIL__</a>
    </div>
  </footer>
</body></html>`;
}
