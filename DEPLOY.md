# Deploy do Katalli em VPS

Sobe a aplicacao, o Postgres e o proxy com TLS em uma VPS Linux.
Testado com Hetzner CX22 (2 vCPU, 4 GB) + Ubuntu 24.04.

Dominio em uso: **katalli.com**, registrado no Squarespace (validade 05/08/2027).

Arquitetura: o Caddy e o unico container exposto a internet (portas 80 e 443).
A aplicacao e o banco nao publicam porta nenhuma no host — so se enxergam pela
rede interna do Compose. Isso significa que **nao existe caminho HTTP em claro**
para as senhas do chat nem para as chaves que o cliente cola em `/integracoes`.

---

## 1. Dominio (Squarespace)

`katalli.com` ja esta registrado. Nada a fazer aqui — o DNS e apontado no
passo 3, quando ja houver um IP para colocar no registro.

## 2A. Railway (PaaS) — caminho recomendado enquanto nao houver escala

Sem servidor para administrar: a plataforma constroi a partir do `Dockerfile`,
fornece TLS e mantem o processo vivo (necessario — ha quatro tarefas agendadas,
e plataforma que hiberna nao executa cron).

O `Caddyfile` e o `docker-compose.prod.yml` NAO sao usados aqui; ficam para o
caminho de VPS, na secao 2B.

### Passos

1. **railway.com** → New Project → *Deploy from GitHub repo* → `nexaAI`.
   O `Dockerfile` e detectado sozinho.
2. **New → Database → PostgreSQL**, no mesmo projeto.
3. No servico da aplicacao, aba **Variables**, defina tudo do `.env` local,
   com estas diferencas:

   | variavel | valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — referencia, nao a URL copiada |
   | `PUBLIC_BASE_URL` | `https://katalli.com` |
   | `GOOGLE_REDIRECT_URI` | `https://katalli.com/google/callback` |
   | `INSTAGRAM_REDIRECT_URI` | `https://katalli.com/instagram/callback` |
   | `ASAAS_BASE_URL` | `https://api.asaas.com/v3` |
   | `PORT` | nao defina — o Railway injeta, e o `main.ts` ja le do ambiente |

   `DATABASE_URL` como **referencia** e nao como texto: se o Postgres for
   recriado, a senha muda e a referencia acompanha sozinha.

4. **Settings → Deploy → Custom Start Command**:

   ```
   npx prisma migrate deploy && node dist/main.js
   ```

   Aplica migracao pendente a cada deploy. E idempotente — `migrate deploy` so
   executa o que falta. Funciona porque `prisma` esta em `dependencies`, e nao
   em `devDependencies`: ele sobrevive ao `npm ci --omit=dev` da imagem.

   > Mantenha **uma instancia**. Com duas subindo ao mesmo tempo, as duas
   > tentariam migrar o banco simultaneamente.

5. **Settings → Networking → Custom Domain** → `katalli.com`. O Railway devolve
   um alvo de CNAME e um TXT de verificacao.

### O DNS precisa sair do Squarespace

O padrao DNS nao permite `CNAME` na raiz de um dominio. Provedores modernos
contornam com `ALIAS`/`ANAME` ou *CNAME flattening*; **o Squarespace nao oferece
nenhum dos dois** e esta na lista de incompativeis da documentacao do Railway.

Mova os nameservers para o **Cloudflare** (gratuito):

1. Crie conta em cloudflare.com e adicione `katalli.com`.
2. O Cloudflare importa os registros existentes — **confira** se vieram o TXT
   `google-site-verification`, o SPF, o DMARC e o DKIM. Recrie o que faltar.
3. No Squarespace: Dominios → katalli.com → **Servidores de nomes de dominio**
   → troque para os dois nameservers que o Cloudflare informar.
4. No Cloudflare, crie o CNAME da raiz apontando para o alvo do Railway. O
   flattening resolve para IP sozinho.
5. Propagacao de nameserver leva de minutos a 24h.

Alternativa sem trocar nameserver: usar `www.katalli.com` como endereco
principal (CNAME funciona em subdominio) e configurar encaminhamento da raiz no
Squarespace. Funciona, mas deixa o produto com `www` na URL.

## 2B. Servidor (VPS)

Serve qualquer VPS com Ubuntu 24.04 e Docker. Duas opcoes testadas:

**Oracle Cloud (Always Free)** — gratuito, e a unica com regiao no Brasil
(Sao Paulo, ~10ms contra ~120ms dos EUA). Escolha a forma **VM.Standard.A1.Flex**
com 4 OCPU e 24 GB. Nao pegue a `E2.1.Micro`: 1 GB de RAM nao sustenta
Node + Postgres + Caddy juntos.

> A A1 e **ARM (aarch64)**, nao x86. A pilha suporta: `node:22-alpine`,
> `postgres:16-alpine` e `caddy:2-alpine` publicam arm64, e o `schema.prisma`
> nao fixa `binaryTargets` — o client e gerado dentro do container, entao
> detecta a arquitetura sozinho. Nao ha nada a mudar. **Nunca adicione
> `platform:` no compose**: isso forcaria emulacao x86 e deixaria tudo lento.

**Hetzner Cloud** — ~€7,50/mes, x86. Local mais proximo: Ashburn (US East).

Em qualquer uma: Ubuntu 24.04 e **adicione sua chave SSH na criacao** — evita a
senha de root que chega por e-mail e vira alvo de forca bruta em minutos.

### Oracle: as duas barreiras de rede

A Oracle bloqueia em DOIS lugares, e esquecer um deles produz o mesmo sintoma
(o site nao responde, o Caddy nao consegue o certificado) sem mensagem util.

**1. Security List da VCN** (no painel): Networking → Virtual Cloud Networks →
sua VCN → Security Lists → Default → *Add Ingress Rules*, para as portas 80 e 443:

| Source CIDR | Protocolo | Porta |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**2. iptables da propria instancia**: a imagem Ubuntu da Oracle ja vem com
regras que barram tudo menos SSH. Dentro da maquina:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Se a capacidade ARM aparecer como indisponivel na regiao, tente de novo mais
tarde ou na regiao vizinha (Vinhedo) — e comum e costuma liberar.

Anote o IPv4. Depois, como root (ou com `sudo`, se entrar como `ubuntu`):

```bash
# Usuario sem privilegio para rodar a aplicacao
adduser --disabled-password --gecos "" katalli
usermod -aG sudo,docker katalli 2>/dev/null || usermod -aG sudo katalli
rsync --archive --chown=katalli:katalli ~/.ssh /home/katalli

# Firewall: so SSH e HTTP(S). O Postgres NAO entra aqui — ele nunca deve
# ser alcancavel de fora, e como nao publica porta, tambem nao seria.
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# SSH sem senha (evita forca bruta; voce ja tem a chave)
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker katalli
```

Saia e entre de novo como `katalli` (o grupo docker so vale em sessao nova).

## 3. DNS (Squarespace)

Painel do Squarespace → **Domains → katalli.com → DNS Settings → Add record**:

| Tipo | Host | Valor |
|---|---|---|
| A | `@` | IPv4 da VPS |
| A | `www` | IPv4 da VPS |

Os DOIS registros sao necessarios: o Caddy pede um certificado por nome, e o
bloco `www` do `Caddyfile` redireciona para o dominio nu. Sem o A de `www`,
quem digitar "www.katalli.com" leva erro de certificado.

**Remova o que o Squarespace deixou apontando para os servidores dele.** Um
dominio recem-comprado costuma vir com registros de parking ou de encaminhamento;
se sobrar um A ou ALIAS no `@`, o trafego vai para o Squarespace e a validacao da
Let's Encrypt falha. Nao use "Forwarding" — tem que ser registro A no IP.

**Espere propagar antes do passo 5.** O Caddy valida o dominio na inicializacao;
se o DNS ainda nao resolver, a emissao falha e ele entra em backoff.

```bash
dig +short katalli.com        # deve devolver o IP da VPS
dig +short www.katalli.com    # idem
```

## 4. Codigo e configuracao

```bash
git clone https://github.com/danielima7/nexaAI.git katalli
cd katalli
```

Crie o `.env` (copie de `.env.example` e preencha). Diferencas em relacao ao
seu `.env` de desenvolvimento:

| Variavel | Valor em producao |
|---|---|
| `DATABASE_URL` | host `postgres`, **nao** `localhost` — e o nome do servico no Compose |
| `PUBLIC_BASE_URL` | `https://katalli.com` (sai do ngrok) |
| `GOOGLE_REDIRECT_URI` | `https://katalli.com/google/callback` |
| `INSTAGRAM_REDIRECT_URI` | `https://katalli.com/instagram/callback` |
| `ASAAS_BASE_URL` | `https://api.asaas.com/v3` (producao) |
| `ASAAS_API_KEY` | chave `$aact_prod_...` — tem que casar com a URL acima, senao o service RECUSA a consulta |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | senha nova e forte, nao a de desenvolvimento |
| `CONNECTION_ENCRYPTION_KEY` | **a mesma** de onde vierem os dados; uma chave nova torna as credenciais ja cifradas ilegiveis, sem recuperacao |

As duas URLs de callback tambem precisam ser cadastradas do lado do provedor,
com o valor IDENTICO — qualquer diferenca (barra no fim, `www`, `http`) resulta
em `redirect_uri_mismatch` na hora de conectar:

- **Google Cloud Console** → APIs & Services → Credentials → o seu OAuth client
  → *Authorized redirect URIs* → `https://katalli.com/google/callback`
- **App da Meta** → Login do Facebook → *Valid OAuth Redirect URIs* →
  `https://katalli.com/instagram/callback`

> ⚠️ Enquanto a tela de consentimento do Google estiver em **"Testing"**, todo
> refresh token expira em 7 dias e o painel/resumo diario quebram semanalmente
> para todos os clientes — medido tres vezes. No mesmo Console:
> **OAuth consent screen → Publish app**. Nenhuma mudanca no codigo contorna isso.

> ⚠️ **Todo valor que contenha `$` precisa de aspas simples** — hoje isso e a
> `ASAAS_API_KEY`. Sem elas o Compose entrega a variavel VAZIA ao container e a
> integracao falha em silencio. Aspas duplas nao protegem. Ver o cabecalho de
> `docker-compose.prod.yml`.

Depois, o dominio do proxy:

```bash
cp .env.caddy.example .env.caddy
nano .env.caddy   # KATALLI_DOMINIO=katalli.com  (sem https://, sem barra final)
```

## 5. Subir

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

Acompanhe a emissao do certificado:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

Verifique: `https://katalli.com/health` deve responder, e o cadeado do
navegador deve estar valido.

> **Nao repita `up --build` em loop enquanto depura TLS.** A Let's Encrypt
> limita 5 certificados por dominio por semana; estourar deixa o site sem HTTPS
> por dias. Se o certificado falhar, leia o log do Caddy e conserte a causa
> (quase sempre DNS ainda nao propagado, ou porta 80 fechada) antes de tentar
> de novo. O volume `caddy-data` preserva o que ja foi emitido entre restarts.

## 6. Depois do primeiro deploy

- **Google Cloud Console** → Credenciais → cliente OAuth "Katalli Web": adicione
  `https://katalli.com/google/callback` aos URIs de redirecionamento
  autorizados. Sem isso o Google devolve `redirect_uri_mismatch`.
- **Reconecte o Google** pelo chat (`katalli_conectar_google`): o refresh token
  antigo foi emitido para a URI do ngrok.
- **Reconecte o Instagram** pelo mesmo motivo, se estiver em uso.
- **Crie o acesso ao chat**: veja *Operação → Dar acesso a um cliente*, abaixo.

## Tarefas agendadas (o que roda sozinho)

O container `app` precisa ficar de pe: estas rotinas nao tem fila nem retentativa
externa, e o que nao rodou no horario nao roda depois.

| Horario (America/Sao_Paulo) | O que faz | Se nao rodar |
|---|---|---|
| 03:10 | Coleta as metricas do dia (Instagram, HubSpot) | **Buraco permanente** no grafico de evolucao. O Instagram nao informa quantos seguidores havia ontem; o dado nao volta. |
| 07:40 | Verifica se as autorizacoes dos clientes ainda funcionam | Voce descobre a integracao quebrada pelo cliente reclamando |
| 08:00 (por cliente) | Resumo diario | O cliente nao recebe o resumo daquele dia |
| a cada 30 min | Compara o gasto de IA do dia com o teto | Um consumo anormal passa sem aviso |

Consequencia pratica: **evite `up --build` entre 03:00 e 04:00**. Um deploy nesse
intervalo custa um ponto da serie historica de todos os clientes.

Os alertas por e-mail dependem de duas coisas: `OWNER_ORGANIZATION_ID` apontando
para a SUA organizacao, e a conexao Google dela valida — o e-mail sai por ela. Se
essa autorizacao cair, voce perde de uma vez o aviso de custo, o de queda da IA e
o de conexoes, **sem nada avisar que os avisos pararam**.

## Operacao

> ⚠️ **No servidor, use os scripts `prod:*`, nao os de desenvolvimento.**
> Os scripts `chat:convite`, `chat:acesso`, `demo:criar` e `credenciais:cifrar`
> rodam com `ts-node`, que e devDependency e **nao existe na imagem de
> producao** (ela roda `npm ci --omit=dev` e nem copia o `src/`). Os `prod:*`
> executam o JavaScript ja compilado em `dist/` e funcionam no container.

### Dar acesso a um cliente

Gera um link de convite. O cliente abre, escolhe a propria senha e ja entra —
voce nunca manuseia a senha dele.

```bash
# Cliente novo (cria a organizacao junto)
docker compose -f docker-compose.prod.yml exec app \
  npm run prod:convite -- --email dono@empresa.com --empresa "Nome da Empresa"

# Pessoa a mais numa organizacao que ja existe
docker compose -f docker-compose.prod.yml exec app \
  npm run prod:convite -- --email outro@empresa.com --org <uuid-da-org>
```

O comando imprime o link. Copie e envie ao cliente. Vale **uma unica vez** e
expira em 7 dias.

### Rotina

```bash
# Atualizar para a ultima versao
git pull && docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

# Logs da aplicacao
docker compose -f docker-compose.prod.yml logs -f app

# Organizacao de demonstracao (para apresentar sem expor dados de ninguem)
docker compose -f docker-compose.prod.yml exec app npm run prod:demo
```

### Backup — roda no HOST, nao dentro do container

O script `banco:backup` chama `docker exec`, que nao existe dentro do
container da aplicacao. Em producao, extraia direto do servico do Postgres:

```bash
mkdir -p backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "backups/katalli-$(date +%F-%H%M).sql"
```

Para automatizar, coloque no crontab do servidor (`crontab -e`), diariamente
as 3h — e **copie o arquivo para fora da VPS**, senao o backup morre junto com
ela:

```
0 3 * * * cd /home/katalli/katalli && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U nexa -d nexa > backups/katalli-$(date +\\%F).sql
```

**Backup e responsabilidade sua, nao da Hetzner.** Snapshot de VPS protege
contra falha de disco, nao contra `DROP TABLE` nem contra a VPS ser perdida com
tudo dentro. Agende o `banco:backup` e copie o `.sql` para fora do servidor —
guardando a `CONNECTION_ENCRYPTION_KEY` em lugar SEPARADO do dump. Juntos, um
unico vazamento entrega as credenciais de todos os clientes.
