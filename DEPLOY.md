# Deploy do Kyrius em VPS

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
adduser --disabled-password --gecos "" kyrius
usermod -aG sudo,docker kyrius 2>/dev/null || usermod -aG sudo kyrius
rsync --archive --chown=kyrius:kyrius ~/.ssh /home/kyrius

# Firewall: so SSH e HTTP(S). O Postgres NAO entra aqui — ele nunca deve
# ser alcancavel de fora, e como nao publica porta, tambem nao seria.
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# SSH sem senha (evita forca bruta; voce ja tem a chave)
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker kyrius
```

Saia e entre de novo como `kyrius` (o grupo docker so vale em sessao nova).

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
git clone https://github.com/danielima7/nexaAI.git kyrius
cd kyrius
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
nano .env.caddy   # KYRIUS_DOMINIO=seudominio.com.br  (sem https://, sem barra final)
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

- **Google Cloud Console** → Credenciais → cliente OAuth "Kyrius Web": adicione
  `https://seudominio.com.br/google/callback` aos URIs de redirecionamento
  autorizados. Sem isso o Google devolve `redirect_uri_mismatch`.
- **Reconecte o Google** pelo chat (`kyrius_conectar_google`): o refresh token
  antigo foi emitido para a URI do ngrok.
- **Crie o acesso ao chat**: `docker compose -f docker-compose.prod.yml exec app npm run chat:acesso`

## Operacao

```bash
# Atualizar para a ultima versao
git pull && docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

# Logs da aplicacao
docker compose -f docker-compose.prod.yml logs -f app

# Backup (grava em ./backups, montado no container do Postgres)
docker compose -f docker-compose.prod.yml exec app npm run banco:backup
```

**Backup e responsabilidade sua, nao da Hetzner.** Snapshot de VPS protege
contra falha de disco, nao contra `DROP TABLE` nem contra a VPS ser perdida com
tudo dentro. Agende o `banco:backup` e copie o `.sql` para fora do servidor —
guardando a `CONNECTION_ENCRYPTION_KEY` em lugar SEPARADO do dump. Juntos, um
unico vazamento entrega as credenciais de todos os clientes.
