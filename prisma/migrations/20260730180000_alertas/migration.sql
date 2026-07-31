-- Alertas: avisam quando o resultado de uma ferramenta muda.
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ferramenta" TEXT NOT NULL,
    "argumentos" JSONB,
    "frequenciaMin" INTEGER NOT NULL DEFAULT 60,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoResultado" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Alert_organizationId_idx" ON "Alert"("organizationId");
