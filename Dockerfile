# Imagem de producao do backend do Katalli.
#
# Build em dois estagios: o primeiro compila (precisa das devDependencies e do
# codigo TypeScript); o segundo carrega apenas o necessario para rodar. Isso
# mantem a imagem final pequena e sem o codigo-fonte nem ferramentas de build.

# ---------- Estagio 1: build ----------
FROM node:22-alpine AS build

WORKDIR /app

# Copiamos apenas os manifests primeiro: enquanto as dependencias nao mudarem,
# o Docker reaproveita esta camada e o build fica muito mais rapido.
COPY package*.json ./
RUN npm ci

# O client do Prisma e gerado a partir do schema, entao ele vem antes do resto.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- Estagio 2: runtime ----------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Apenas dependencias de producao.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# O Prisma precisa do schema e do client gerado em tempo de execucao.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

# Roda como usuario sem privilegios: se a aplicacao for comprometida, o
# atacante nao herda root dentro do container.
USER node

EXPOSE 3000

# O healthcheck consulta o banco — um processo que responde HTTP mas nao
# alcanca o Postgres e considerado doente e pode ser reiniciado.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
