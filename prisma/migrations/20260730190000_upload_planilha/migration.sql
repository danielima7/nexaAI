-- Planilhas enviadas pelo cliente no chat (conteudo ja extraido em texto).
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "nomeArquivo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "totalLinhas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Upload_organizationId_idx" ON "Upload"("organizationId");
