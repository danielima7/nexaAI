-- Consumo de tokens por chamada a API da Anthropic.
-- Granularidade diferente de OperationLog: um turno do usuario gera varias
-- chamadas (loop de tool use), cada uma com seu proprio custo.
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "rota" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "rodada" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsage_organizationId_createdAt_idx" ON "AiUsage"("organizationId", "createdAt");

CREATE INDEX "AiUsage_modelo_createdAt_idx" ON "AiUsage"("modelo", "createdAt");
