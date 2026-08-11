-- Plano comercial e cota diaria de tokens.
--
-- `plano` diz a qual plano a empresa pertence; a cota de cada plano fica em
-- codigo (src/ai/planos.ts), para um reajuste valer para todos os clientes
-- daquele plano sem varrer o banco.
--
-- `limiteTokensDia` e o override por organizacao: NULL = usa a cota do plano.
ALTER TABLE "Organization" ADD COLUMN "plano" TEXT NOT NULL DEFAULT 'padrao';
ALTER TABLE "Organization" ADD COLUMN "limiteTokensDia" INTEGER;

-- Consulta quente do limite: soma dos tokens da organizacao no dia corrente.
-- Sem este indice, cada mensagem enviada varreria a tabela inteira de uso —
-- que so cresce.
CREATE INDEX "AiUsage_organizationId_createdAt_rota_idx"
  ON "AiUsage"("organizationId", "createdAt", "rota");
