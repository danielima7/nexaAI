-- Graficos salvos do painel.
--
-- `config` guarda o mapeamento que a IA inferiu (qual coluna e rotulo, qual e
-- valor, como agregar). Fica em JSON porque o formato depende da fonte do
-- dado: planilha hoje, CRM e financeiro depois, cada um com campos proprios.
-- Colunar isso agora criaria uma tabela larga cheia de NULL.
CREATE TABLE "PainelCard" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "fonte" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PainelCard_pkey" PRIMARY KEY ("id")
);

-- Consulta unica do painel: os cards de uma organizacao, na ordem de exibicao.
CREATE INDEX "PainelCard_organizationId_ordem_idx"
  ON "PainelCard"("organizationId", "ordem");
