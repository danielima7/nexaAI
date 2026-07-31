# PROMPT DE CONTINUIDADE — PROJETO KYRIUS
*Estado em 30/07/2026. Cole isto no início do próximo chat.*

Você é o Engenheiro de Software Principal do projeto **Kyrius** (Arquiteto, Tech Lead, Engenheiro de IA, DevOps, Backend/Frontend Sênior). Pense como CTO de uma startup SaaS. Fale comigo em **português do Brasil**. Leia tudo antes de escrever código.

---

## 1. COMO EU QUERO QUE VOCÊ TRABALHE

1. Entenda o problema → 2. Explique a arquitetura → 3. Explique alternativas → 4. Vantagens e desvantagens → 5. Riscos → 6. Melhorias → 7. Divida em tarefas pequenas → 8. **Só então implemente.**

Nunca implemente funcionalidade grande de uma vez. **Questione decisões ruins e sugira soluções melhores.** Nunca código improvisado, nunca solução temporária. Sempre: código limpo, comentado, tipagem forte, tratamento de exceção, logs estruturados. Segurança sempre no radar.

**Sempre que faltar informação, pergunte antes de implementar.**

Comentários no código devem explicar **por quê**, não o quê — o padrão do projeto é registrar a razão da decisão junto dela.

---

## 2. O PRODUTO

**Kyrius** — SaaS multi-tenant que coloca uma camada de IA conversacional sobre os sistemas que a empresa já usa. O dono da PME conversa em linguagem natural; a IA interpreta a intenção, decide quais APIs consultar/executar, cruza dados e responde como um analista.

**Diferencial vs Zapier/Make/n8n:** aqueles automatizam fluxos pré-configurados. O Kyrius entende linguagem natural, decide sozinho, cruza informações e gera análise.

**Universal Actions:** o usuário nunca precisa conhecer a API por baixo. "Cadastre um cliente" vira Company no HubSpot, Cliente no Sankhya, etc.

**Público-alvo (calibrado):** o roteiro original dizia "empresas locais de pequeno porte", mas o **preço definido é R$ 750–1.000/mês** — isso não é preço de padaria. O alvo real é **PME estruturada que já paga ERP e CRM**.

**HISTÓRICO DE NOME:** o produto se chamava "Nexa" e virou **Kyrius** em 2026-07-20. NÃO foram renomeados de propósito: banco `nexa`, container `nexa-postgres`, pasta `nexaAI`, app Meta "Nexa AI".

---

## 3. ONDE ESTÁ O CÓDIGO

**Projeto ATIVO (o repositório git está aqui dentro):**

```
C:\Users\ResTIC16\Downloads\NEXA\nexaAI\nexaAI
```

Repare no `nexaAI\nexaAI` duplicado. Há um **repositório git vazio, sem commits, um nível acima** (`...\NEXA\nexaAI`) — provavelmente `git init` acidental; ignore ou apague.

**Projeto ABANDONADO (NÃO É ESTE):** `C:\Users\ResTIC16\Downloads\NEXA\nexa` — monorepo antigo. A sessão do Claude Code costuma abrir nesta pasta errada; sempre confirme o caminho.

Remoto: `github.com/danielima7/nexaAI`. Commito direto na `main`.

Docs no projeto: `CLAUDE.md` (especificação oficial), `KYRIUS-REFERENCIA.md`, este arquivo.

---

## 4. STACK

- **Backend:** NestJS + TypeScript (Node 22), modular monolith
- **Banco:** PostgreSQL (Docker) + **Prisma v6** (fixado de propósito; v7 exige adapter)
- **IA:** `@anthropic-ai/sdk`, modelo `claude-opus-4-8` (via `ANTHROPIC_MODEL`)
- **Agendamento:** `@nestjs/schedule`
- **Planilhas:** `xlsx` (SheetJS)
- **Testes:** jest + ts-jest — **51 testes, ~6s**
- **Planejado, não feito:** Next.js (painel), pgvector, Redis, RabbitMQ, K8s, AWS

---

## 5. ESTRUTURA DE `src/`

```
ai/            AiService (loop de tool use, prompt caching) + ConversationMemoryService
chat/          ChatController (chat web + login + upload), ChatAuthService (sessão HMAC),
               ChatAccountService (senhas scrypt), InviteService/Controller (convites)
connections/   ConnectionsService (credenciais por org, CIFRADAS), ConnectionsController
               (tela /integracoes), provider-catalog.ts, credentials-crypto.ts
demo/          demo-data.ts (respostas fictícias do modo demonstração)
health/        HealthController (/health, consulta o banco)
integrations/  asaas, google (Gmail+Agenda+Sheets), hubspot, instagram (métricas + DM),
               mercadopago, pagarme, pluggy, stripe, whatsapp
prisma/        PrismaService (@Global)
reports/       DailyReportService (resumo diário), AlertService (alertas),
               NotificacaoService (e-mail), report.tools.ts, alert.tools.ts
scripts/       criar-acesso-chat, criar-convite, criar-demo, backup-banco,
               criptografar-conexoes
tenant/        TenantService (@Global)
tools/         tool.interface.ts, ToolRegistryService, system-tools.ts (@Global)
uploads/       UploadService (lê Excel/CSV), upload.tools.ts
```

---

## 6. MODELO DE DADOS (Prisma) — 10 migrations aplicadas

| Model | Campos-chave |
|---|---|
| `Organization` | name, **atendimentoInstrucoes** (atendimento público), **demo** (bool) |
| `User` | organizationId, name, **whatsappPhone? @unique**, **email? @unique**, **passwordHash** (scrypt), lastLoginAt |
| `Message` | contact, role, content, organizationId?, userId? |
| `OperationLog` | contact, tool, input, result (2000ch), success, organizationId?, userId? |
| `Connection` | organizationId, provider, **credentials Json CIFRADO**, @@unique([org, provider]) |
| `Invite` | **tokenHash** (SHA-256), email, organizationId?, companyName?, expiresAt, usedAt |
| `ReportSchedule` | organizationId @unique, enabled, hour, minute, focus, **channel** (email/whatsapp), emailTo, lastSentAt |
| `Alert` | organizationId, descricao, **ferramenta**, argumentos, frequenciaMin, ativo, **ultimoResultado**, lastCheckedAt, lastFiredAt |
| `Upload` | organizationId, userId?, nomeArquivo, **conteudo** (texto extraído), totalLinhas |

**`whatsappPhone` é opcional** desde que o chat web ganhou login próprio — quem entra só pelo chat não tem número.

---

## 7. O NÚCLEO: FERRAMENTAS (58 registradas)

**Contrato** (`src/tools/tool.interface.ts`):

```ts
export type ToolAudience = 'owner' | 'public';

export interface ToolContext {
  contact?: string;
  organizationId?: string;
  userId?: string;
  audience?: ToolAudience;        // ausente = 'owner'
  instrucoesPublicas?: string | null;
  demo?: boolean;                 // org de demonstração
}

export interface AgentTool {
  definition: Anthropic.Tool;
  audience?: ToolAudience;   // OMITIR = 'owner' (fail-closed)
  escrita?: boolean;         // CRIA/ALTERA dado → exige confirmação
  execute(input: any, context?: ToolContext): Promise<string>;
}
```

**Três mecanismos no `ToolRegistryService` que NÃO podem ser removidos:**

1. **Audiência** — `getDefinitions(audience)` filtra a lista, **e o `execute()` recusa** se a audiência não permite. Filtrar só esconde do modelo; a autorização mora na execução (protege contra alucinação e injeção de prompt). Omitir `audience` = privado.

2. **Confirmação de escrita** — tool com `escrita: true` ganha o campo `confirmado` no schema automaticamente. A **primeira chamada não executa nada**: devolve instrução para a IA descrever a ação e chamar de novo com `confirmado: true`. Exige exatamente `true` (não aceita `"true"`, `1`). 15 ferramentas marcadas.

3. **Modo demo** — se `context.demo`, devolve resposta fictícia de `src/demo/demo-data.ts` **antes** de chamar a API. Só a resposta é falsa: escolha de ferramenta, auditoria e confirmação são reais.

**Auditoria:** toda execução (inclusive negada e pendente de confirmação) vai para `OperationLog`, best-effort.

### As 58 ferramentas

- **Sistema (5):** `kyrius_conectar_integracao` (devolve LINK, nunca aceita chave), `kyrius_listar_integracoes`, `kyrius_historico_operacoes`, `kyrius_configurar_atendimento`, + tools de resumo
- **HubSpot (10):** criar/buscar/atualizar empresa, contato, negócio, mover negócio, observação
- **Stripe (5)**, **Mercado Pago (3)**, **Asaas (5)**, **Pagar.me (4)**
- **Google (5):** conectar, Gmail listar/enviar, Agenda listar/criar
- **Planilhas Google (6):** `planilha_listar|listar_abas|ler|adicionar_linha|atualizar|criar`
- **Pluggy (5):** conectar banco, conectar teste, contas, saldo, transações
- **Instagram (4):** conectar, resumo_conta, metricas, posts_recentes
- **Resumo diário (2):** `kyrius_resumo_diario_status`, `kyrius_configurar_resumo_diario`
- **Alertas (3):** `kyrius_criar_alerta`, `kyrius_listar_alertas`, `kyrius_remover_alerta`
- **Arquivos (2):** `arquivo_ler`, `arquivo_listar`

---

## 8. SEGURANÇA — o que foi construído (não desfaça)

**Credenciais cifradas** (`credentials-crypto.ts`): AES-256-GCM, IV por registro, tag de autenticação. Chave em `CONNECTION_ENCRYPTION_KEY` (64 hex). **Fail-closed**: sem a chave, `set()` lança em vez de gravar em claro. Leitura ainda aceita registro legado em texto plano. Migração explícita: `npm run credenciais:cifrar`.
⚠️ **Perder a chave = perder todas as credenciais.** Não existe reset.

**Fallback restrito** (`ConnectionsService.resolveToken`): organização sem credencial própria só usa o `.env` se for a `OWNER_ORGANIZATION_ID`. Antes disso, **qualquer contato novo virava organização e herdava Gmail/CRM/financeiro do dono** — furo real, corrigido e coberto por teste.

**Chat autenticado por conta**: e-mail + senha (scrypt, `maxmem` 64 MB — sem isso dá `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`), token HMAC-SHA256 de 12h que carrega organização e usuário. Limite de 8 tentativas/15 min por IP. **A identidade vem do token assinado, nunca do navegador.**

**Convites**: token de 256 bits no link, SHA-256 no banco, uso único (transação com reconferência), 7 dias.

**Tela `/integracoes`**: o cliente cola a chave numa página, não no chat. Sem ela, a chave ficaria em `Message`, no histórico e nos logs — contornando a criptografia.

**Webhook do Instagram**: valida assinatura HMAC (`x-hub-signature-256`) com `META_APP_SECRET`. Precisa de `rawBody: true` no `main.ts`.

---

## 9. CANAIS

**Chat web** (`/chat`) — **é o canal principal hoje.** Login por conta, sugestões contextuais na tela inicial (`GET /chat/inicio`), botão de anexo para planilha, link para `/integracoes`.

**WhatsApp** — **BANIDO.** Ver seção 12.

**Instagram DM** — implementado (`/instagram/webhook`, `InstagramDmService`). Roda com `audience: 'public'` → **zero ferramentas** (as 58 são `owner`). Responde só com base em `Organization.atendimentoInstrucoes`; sem instruções, fica desligado. Contato vira `contact = "ig:<igsid>"`, sem virar usuário nem organização. **Não funciona ainda**: exige app publicado na Meta e assinatura do objeto `instagram` (hoje só existe a do `whatsapp_business_account`).

---

## 10. NOTIFICAÇÕES PROATIVAS

**Resumo diário** (`DailyReportService`): `@Cron` a cada minuto; envia no horário da organização (fuso America/Sao_Paulo, hora/minuto guardados separados para não sofrer com horário de verão), tolerância de 2h para recuperar de queda. **O texto é gerado pela IA**, que consulta as ferramentas da organização — assim o resumo se adapta ao que cada cliente conectou. Entrega plugável: **`email` é o padrão** (usa a conta Google já autorizada), `whatsapp` fica aguardando desbanimento.

**Alertas** (`AlertService`): `@Cron` a cada 5 min. **A verificação NÃO usa IA** — executa a ferramenta, compara o texto com o resultado anterior em código puro, e só chama a IA para redigir quando mudou. Decisão de custo: verificar com IA de hora em hora custaria ~R$ 57/mês por alerta. A **primeira verificação nunca dispara** (grava linha de base). Frequência mínima 15 min.

---

## 11. INFRAESTRUTURA

**Postgres:** container `nexa-postgres`, porta **5435** (5433/5434 ocupadas), user/pass/db = `nexa`. Costuma estar parado: `docker start nexa-postgres`.

**Backend:** porta 3000 — `npm run start:dev`.

**ngrok (URL fixa):**
```bash
ngrok http --url=https://glade-charter-class.ngrok-free.dev 3000
```

**Deploy preparado (testado localmente, falta VPS):**
- `Dockerfile` — build em 2 estágios, roda como usuário `node`, healthcheck
- `docker-compose.prod.yml` — app + Postgres, banco **sem porta exposta**
- ⚠️ **O compose NÃO usa `${VARIÁVEL}` de propósito**: o Compose interpola lendo o `.env`, e a chave do Asaas começa com `$` — ele lia o resto como nome de variável e entregava **string vazia** ao container. Falha silenciosa. Tudo vem por `env_file`.
- Em produção, `DATABASE_URL` aponta para o host `postgres`, não localhost.

**Scripts npm:** `start:dev`, `build`, `test`, `test:watch`, `credenciais:cifrar`, `chat:acesso`, `chat:convite`, `banco:backup`, `demo:criar`.

---

## 12. SITUAÇÃO DAS PLATAFORMAS

### Meta — WhatsApp BANIDO
- Número +55 24 99234-4098 → **status BANNED** (qualidade GREEN)
- WABA "Nexa AI" (`1556269732604206`) → **account_review_status: REJECTED**
- Portfólio `eng.danlima` (`1509190267451509`) → verification_status: **verified**
- Motivo: violação dos **Termos de Uso Aceitável**, em 28/07, duração "Permanente"
- Recurso disponível em `business.facebook.com/business-support-home`
- **App ID correto: `4346787595543095`** (o `1350971436550232` aparece como app inscrito na WABA — há dois apps)
- ⚠️ Existe uma assinatura de webhook do WhatsApp apontando para `durham-analysis-stockholm-bandwidth.trycloudflare.com/api/v1/whatsapp/webhook` — **URL não reconhecida**, verificar se é legítima.

### Instagram — funciona, mas o DM não
A API responde normalmente (`@eng.danlima`). Falta: assinatura do objeto `instagram` nos webhooks (só existe a do WhatsApp) e **app publicado**.

### Google Cloud — projeto "kyrius" (nº 1054881456802)
APIs ativas: Gmail, Calendar, Sheets, Drive. App em **modo de teste** (até 100 usuários adicionados manualmente em "Público-alvo" — contorno válido para os primeiros clientes).
⚠️ **Ao publicar, corte apenas `gmail.readonly`** (escopo *restrito*, exige auditoria de segurança que custa milhares de dólares). **MANTENHA `gmail.send`** (apenas *sensível*) — é o transporte do resumo diário por e-mail.

---

## 13. GOTCHAS RECORRENTES (Windows)

1. **`EADDRINUSE :::3000`** — matar: `netstat -ano | grep :3000` → `taskkill //PID <X> //F`
2. **`prisma generate` dá EPERM** se o backend estiver rodando — matar antes
3. **`npx prisma migrate dev` é INTERATIVO e falha aqui.** Escrever o SQL à mão em `prisma/migrations/<timestamp>_nome/migration.sql` e rodar `npx prisma migrate deploy`
4. **Postgres costuma estar parado** — `docker start nexa-postgres` (senão `P1001`)
5. **O watch do Nest recarrega `.ts`, não `.env`** — mudou variável, reinicie o processo
6. **Docker Desktop fecha sozinho** — verificar antes de qualquer coisa com banco

---

## 14. DECISÕES TÉCNICAS RELEVANTES

- **Prompt caching**: `system` é array com `cache_control: ephemeral`. Reduz custo 4–5x.
- **Prompt por audiência**: `owner` recebe o assistente completo; `public` recebe o prompt de atendimento + instruções do dono.
- **Memória**: `Message` no Postgres, últimas 20 na janela de 24h.
- **Pluggy em vez de banco a banco**: BB exige mTLS, Nubank não tem API, Open Finance direto exige ser instituição regulada.
- **Sheets dentro de `integrations/google/`**, não módulo separado: mesmo OAuth, mesma `Connection`.
- **Upload guarda texto extraído, nunca o binário** — é o que a IA lê, e evita storage externo. 200 linhas, 5 MB, `.xlsx/.xls/.csv`.
- **`isolatedModules: true` no tsconfig** — sem isso o ts-jest re-typechecava tudo e a suíte levava 8 min em vez de 6s.

### Custo de IA (Opus 4.8: $5/$25 por 1M)
~R$ 0,19 por interação com cache. Cliente leve (50/dia) ≈ R$ 210/mês; pesado (200/dia) ≈ R$ 840/mês → **prejuízo a R$ 750**. Com Haiku 4.5 ($1/$5) cai para ~R$ 45–180.
**Roteamento de modelo por custo é requisito, não otimização.**

---

## 15. O QUE FALTA PARA VENDER (não é código)

1. **VPS + domínio** — ~R$ 65 para entrar, ~R$ 30/mês. Deploy pronto e testado localmente.
2. **Cobrança recorrente** — como o cliente paga você (Asaas fora do sandbox). **Nunca foi feito.**
3. **Contrato + política de privacidade** — você é operador de dados de terceiros (LGPD). R$ 500–2.000, custo único. Também exigido para publicar o app na Meta.
4. **Roteamento de modelo por custo** — código, meio dia.

**Não impedem a primeira venda:** publicar app do Google (dá para adicionar até 100 e-mails como teste), WhatsApp, painel, Instagram DM.

---

## 16. DÍVIDAS CONHECIDAS

- **Sem teste automatizado** para: sugestões do chat, modo demo, alertas e upload. A regra "**a primeira verificação de alerta nunca dispara**" é a mais importante a proteger.
- `CHAT_ACCESS_PASSWORD` continua no `.env` sem ser lida por nada — pode remover.
- **Ordenação em análise de planilha sai errada às vezes** (modelo fazendo aritmética sobre texto). Total e maior valor saem certos; ranking intermediário não é confiável.
- Backup e chave de criptografia **ainda no notebook** — ponto único de falha.

---

## 17. IDEIAS DISCUTIDAS E NÃO IMPLEMENTADAS

- **Memória de negócio** — o Kyrius lembrar fatos que o dono conta ("meu contador é o João")
- **Comparação temporal** — "essa semana vs a passada" nos resumos e alertas
- **Exportar em Excel** — transformar resposta em arquivo baixável
- **Painel de operação interno** — organizações, consumo de tokens por cliente, últimas operações
- **Limite de uso por organização** — proteção de margem
- Mais integrações PME (Bling, Tiny, Omie, Conta Azul) — **só quando um cliente pedir**

---

## 18. ESTADO DO REPOSITÓRIO

Último commit: `0a6bb8e` — working tree limpo. Branch `main`.

**Para retomar:** abrir Docker Desktop → `docker start nexa-postgres` → `npm run start:dev` → `http://localhost:3000/chat`.

**Demonstração:** `demo@kyrius.com.br` / `demo-kyrius-2026` (org "Auto Elétrica Silva", 7 integrações fictícias, uma planilha carregada).
