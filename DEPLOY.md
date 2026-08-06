# Deploy do Katalli em VPS

Sobe a aplicacao, o Postgres e o proxy com TLS em uma VPS Linux.
Testado com Hetzner CX22 (2 vCPU, 4 GB) + Ubuntu 24.04 + dominio `.com.br`.

Arquitetura: o Caddy e o unico container exposto a internet (portas 80 e 443).
A aplicacao e o banco nao publicam porta nenhuma no host — so se enxergam pela
rede interna do Compose. Isso significa que **nao existe caminho HTTP em claro**
para as senhas do chat nem para as chaves que o cliente cola em `/integracoes`.

---

## 1. Dominio (Registro.br)

Registre em <https://registro.br> (~R$40/ano, exige CPF ou CNPJ). Deixe para
apontar o DNS no passo 3, quando ja houver um IP.

## 2. Servidor

Crie a VPS (Hetzner Cloud → Add Server): Ubuntu 24.04, tipo CX22, e **adicione
sua chave SSH na criacao** — evita a senha de root que chega por e-mail.

Anote o IPv4. Depois, como root:

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

## 3. DNS

No Registro.br, em "Editar zona DNS", crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | IPv4 da VPS |
| A | `www` | IPv4 da VPS |

**Espere propagar antes do passo 5.** O Caddy valida o dominio com a Let's
Encrypt na inicializacao; se o DNS ainda nao resolver, a emissao falha.
Confirme com `dig +short seudominio.com.br` (deve devolver o IP da VPS).

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
| `PUBLIC_BASE_URL` | `https://seudominio.com.br` (sai do ngrok) |
| `GOOGLE_REDIRECT_URI` | `https://seudominio.com.br/google/callback` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | senha nova e forte, nao a de desenvolvimento |
| `CONNECTION_ENCRYPTION_KEY` | **a mesma** de onde vierem os dados; uma chave nova torna as credenciais ja cifradas ilegiveis, sem recuperacao |

> ⚠️ **Todo valor que contenha `$` precisa de aspas simples** — hoje isso e a
> `ASAAS_API_KEY`. Sem elas o Compose entrega a variavel VAZIA ao container e a
> integracao falha em silencio. Aspas duplas nao protegem. Ver o cabecalho de
> `docker-compose.prod.yml`.

Depois, o dominio do proxy:

```bash
cp .env.caddy.example .env.caddy
nano .env.caddy   # KATALLI_DOMINIO=seudominio.com.br  (sem https://, sem barra final)
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

Verifique: `https://seudominio.com.br/health` deve responder, e o cadeado do
navegador deve estar valido.

> **Nao repita `up --build` em loop enquanto depura TLS.** A Let's Encrypt
> limita 5 certificados por dominio por semana; estourar deixa o site sem HTTPS
> por dias. Se o certificado falhar, leia o log do Caddy e conserte a causa
> (quase sempre DNS ainda nao propagado, ou porta 80 fechada) antes de tentar
> de novo. O volume `caddy-data` preserva o que ja foi emitido entre restarts.

## 6. Depois do primeiro deploy

- **Google Cloud Console** → Credenciais → cliente OAuth "Katalli Web": adicione
  `https://seudominio.com.br/google/callback` aos URIs de redirecionamento
  autorizados. Sem isso o Google devolve `redirect_uri_mismatch`.
- **Reconecte o Google** pelo chat (`katalli_conectar_google`): o refresh token
  antigo foi emitido para a URI do ngrok.
- **Crie o acesso ao chat**: veja *Operação → Dar acesso a um cliente*, abaixo.

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
