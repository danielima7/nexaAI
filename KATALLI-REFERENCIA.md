# KATALLI — Documento de Referência do Projeto

> ⚠️ **SEGURANÇA:** Este arquivo **não contém** os valores secretos (tokens, chaves, senhas).
> Ele diz **onde** cada segredo está e **como regenerá-lo**. Os valores reais ficam:
> - no arquivo **`.env`** (na raiz do projeto — já protegido pelo `.gitignore`, não vai para o Git);
> - nos **painéis das contas** (Meta, Anthropic, ngrok);
> - e as **senhas de login** devem ficar num **gerenciador de senhas** (ex: Bitwarden, 1Password, ou o gerenciador do navegador).
> Este arquivo também está no `.gitignore` — não suba ele para o GitHub.

Última atualização: 16/07/2026

---

## 1. Resumo do que foi construído hoje

Partindo do zero, foi criado um assistente de IA que atende pelo WhatsApp:

1. **Conta e app na Meta (Facebook Developers)** — criado o app "Katalli AI" com o produto WhatsApp.
2. **Número de teste** da Meta (grátis) — usado para os primeiros testes.
3. **Backend NestJS** (este projeto) — módulo de WhatsApp (webhook) + módulo de IA.
4. **Túnel ngrok** com **URL fixa** — expõe o backend local para a Meta chamar.
5. **Número real** (`+55 24 99234-4098`) conectado e respondendo.
6. **Token permanente** do WhatsApp (não expira).
7. **IA (Claude / Anthropic)** integrada — o Katalli entende e responde em linguagem natural.
8. **Verificação de empresa (CNPJ)** enviada à Meta — **em análise** (~2 dias úteis).
9. Confirmado: **múltiplas pessoas** conversam com o Katalli (cada uma manda a 1ª mensagem para abrir a janela de 24h).

**Estado atual:** Katalli conversando por IA no WhatsApp. Ainda **sem** Tools (ações nas integrações) e **sem** memória de conversa — são os próximos passos.

---

## 2. Contas e onde fazer login

| Serviço | URL de acesso | Login / dono | Senha |
|---|---|---|---|
| Facebook / Meta Developers | https://developers.facebook.com | Conta Facebook pessoal (Daniel Lima) | *(no gerenciador de senhas)* |
| Meta Business (Portfólio) | https://business.facebook.com | Portfólio **Katalli** / negócio **eng.danlima** | *(mesma conta Facebook)* |
| WhatsApp Manager | https://business.facebook.com/wa/manage | mesma conta Meta | — |
| Anthropic Console (IA) | https://console.anthropic.com | e-mail da conta Anthropic | *(no gerenciador de senhas)* |
| ngrok (túnel) | https://dashboard.ngrok.com | conta ngrok | *(no gerenciador de senhas)* |
| GitHub (repositório) | https://github.com | conta GitHub (Daniel Lima) | *(no gerenciador de senhas)* |

> Preencha a coluna "Senha" **no seu gerenciador de senhas**, não aqui.

---

## 3. Configurações do app Meta / WhatsApp (dados NÃO secretos)

| Item | Valor |
|---|---|
| Nome do app | Katalli AI |
| **App ID** | `1350971436550232` |
| **Business ID** (portfólio Katalli) | `1509190267451509` |
| **Número REAL (produção)** | +55 24 99234-4098 |
| **Phone Number ID (real)** | `1183269124872909` |
| **WABA ID (real — "Katalli AI")** | `1556269732604206` |
| Número de teste (Meta, grátis) | +1 (555) 175-1876 |
| Phone Number ID (teste) | `1202341592967597` |
| WABA ID (teste) | `1483678073447627` |
| Versão da Graph API | v21.0 |

---

## 4. Webhook (como a Meta chama o backend)

| Item | Valor |
|---|---|
| **URL de callback** | `https://glade-charter-class.ngrok-free.dev/webhook` |
| **Verify token** | está no `.env` como `WHATSAPP_VERIFY_TOKEN` (valor combinado: `nexa-verify-2026`) |
| Campo assinado | `messages` |
| Onde configurar | Painel Meta → WhatsApp → Etapa 2 → "Configurar webhooks" |

> A URL do ngrok é **fixa** (domínio de desenvolvimento reservado na conta). Se você reiniciar o ngrok, **use sempre** o comando com `--url` (ver seção 7) para manter a mesma URL.

---

## 5. Inventário de SEGREDOS (onde estão e como regenerar)

> Os valores reais **não** estão aqui. Ficam no `.env` e/ou nos painéis.

| Segredo | Onde está o valor | Como regenerar se precisar |
|---|---|---|
| **Token de acesso do WhatsApp** (permanente) | `.env` → `WHATSAPP_ACCESS_TOKEN` | Painel Meta → WhatsApp → Etapa 2 → "Step 1: Generate token" |
| **API Key da Anthropic** | `.env` → `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys → "Create Key" (aparece só 1 vez) |
| **Verify token do webhook** | `.env` → `WHATSAPP_VERIFY_TOKEN` | Você define (qualquer string); tem que ser igual no `.env` e no painel Meta |
| **App Secret da Meta** (ainda não usado) | Painel Meta → Configurações do app → Básico | Painel Meta (mesmo local) — usar para validar assinatura dos webhooks no futuro |
| **Authtoken do ngrok** | Já configurado no ngrok (arquivo `ngrok.yml`) | https://dashboard.ngrok.com → Your Authtoken |

**Regra de ouro:** se algum segredo vazar (aparecer em print, chat, e-mail), **regenere-o** no painel correspondente — isso invalida o antigo.

---

## 6. Estrutura do projeto (backend)

```
nexaAI/
├── .env                       # SEGREDOS (não versionar)
├── .env.example               # modelo das variáveis
├── CLAUDE.md                  # especificação oficial do projeto
├── KATALLI-REFERENCIA.md         # este documento
├── package.json
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── ai/                     # módulo de IA (Claude)
    │   ├── ai.module.ts
    │   └── ai.service.ts
    └── integrations/whatsapp/  # integração WhatsApp
        ├── whatsapp.module.ts
        ├── whatsapp.controller.ts   # webhook (GET verificação + POST mensagens)
        └── whatsapp.service.ts      # recebe msg, chama a IA, responde
```

---

## 7. Como rodar o projeto (passo a passo)

Pasta do projeto: `C:\Users\ResTIC16\Downloads\NEXA\nexaAI\nexaAI` (a pasta ainda se chama NEXA/nexaAI internamente).

**Passo 1 — Banco de dados (Postgres via Docker):**
```
docker start nexa-postgres
```
(só é necessário se o container estiver parado; verifique com `docker ps`)

**Passo 2 — Terminal A — backend:**
```
npm install        # só na primeira vez
npm run start:dev
```

**Passo 3 — Terminal B — túnel ngrok (URL fixa):**
```
ngrok http --url=https://glade-charter-class.ngrok-free.dev 3000
```

Depois, confirme no painel Meta que a URL de callback do webhook está apontando para
`https://glade-charter-class.ngrok-free.dev/webhook` (normalmente já está).

**Testar:** mande uma mensagem no WhatsApp para **+55 24 99234-4098**. O Katalli responde com IA.

> Se o `start:dev` der erro `EADDRINUSE :::3000`, mate o processo preso na porta e rode de novo.

---

## 8. Limitações atuais (modo de desenvolvimento)

- O Katalli só **responde** dentro da janela de 24h (a pessoa precisa mandar a 1ª mensagem).
- Não dá para o Katalli **iniciar** conversa com quem nunca falou com ele (precisa de templates + app publicado).
- Limite de usuários diferentes por dia é baixo.
- Isso **melhora** quando a **verificação de empresa (CNPJ)** for aprovada e o app for publicado (modo "Ativo").

---

## 9. Próximos passos planejados

1. **Memória de conversa** — o Katalli lembrar do contexto da conversa (hoje cada mensagem é isolada).
2. **Tools (ferramentas)** — dar à IA a capacidade de consultar/executar ações nas integrações (HubSpot, bancos, ERPs...), como no CLAUDE.md.
3. **Banco de dados (PostgreSQL)** — histórico, logs, multiempresa, multiusuário.
4. **Publicação do app** — após a verificação de empresa aprovar: colocar o app em modo "Ativo" + aprovar nome de exibição.
5. **Servidor real (produção)** — sair do ngrok e hospedar o backend com domínio próprio.
