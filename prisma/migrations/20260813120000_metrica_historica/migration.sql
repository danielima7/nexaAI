-- Serie temporal das metricas do cliente.
--
-- Existe porque Instagram, HubSpot e Gmail so respondem sobre o agora: nenhuma
-- dessas APIs deixa perguntar "como estava mes passado". Historico so existe se
-- nos gravarmos, e o passado nao volta — cada dia sem coleta e um buraco
-- permanente no grafico do cliente.
CREATE TABLE "Metrica" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "valor" DOUBLE PRECISION NOT NULL,
  "dia" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Metrica_pkey" PRIMARY KEY ("id")
);

-- Uma medicao por serie por dia: torna a coleta reexecutavel sem duplicar
-- ponto no grafico (restart do processo, rodada manual para tapar buraco).
CREATE UNIQUE INDEX "Metrica_organizationId_chave_dia_key"
  ON "Metrica"("organizationId", "chave", "dia");

-- Consulta do painel: uma serie de uma organizacao, em ordem cronologica.
CREATE INDEX "Metrica_organizationId_chave_dia_idx"
  ON "Metrica"("organizationId", "chave", "dia");
