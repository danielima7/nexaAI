-- Consentimento e templates do WhatsApp.
--
-- A politica do WhatsApp exige autorizacao previa do destinatario e, fora da
-- janela de 24h, template aprovado. Sem estas tabelas nao ha como cumprir
-- nenhuma das duas — e a consequencia documentada e o encerramento da conta.
CREATE TABLE "ConsentimentoWhatsapp" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "telefone" TEXT NOT NULL,
  "nome" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ativo',
  "origem" TEXT NOT NULL,
  "consentidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revogadoEm" TIMESTAMP(3),
  "ultimaEntradaEm" TIMESTAMP(3),

  CONSTRAINT "ConsentimentoWhatsapp_pkey" PRIMARY KEY ("id")
);

-- Um registro por numero por organizacao: consentimento duplicado abriria
-- espaco para um "ativo" conviver com um "revogado" e o envio pegar o errado.
CREATE UNIQUE INDEX "ConsentimentoWhatsapp_organizationId_telefone_key"
  ON "ConsentimentoWhatsapp"("organizationId", "telefone");

CREATE INDEX "ConsentimentoWhatsapp_organizationId_status_idx"
  ON "ConsentimentoWhatsapp"("organizationId", "status");

CREATE TABLE "TemplateWhatsapp" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "idioma" TEXT NOT NULL DEFAULT 'pt_BR',
  "corpo" TEXT NOT NULL,
  "variaveis" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'rascunho',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TemplateWhatsapp_pkey" PRIMARY KEY ("id")
);

-- A Meta identifica o template por nome + idioma; a unicidade acompanha isso.
CREATE UNIQUE INDEX "TemplateWhatsapp_organizationId_nome_idioma_key"
  ON "TemplateWhatsapp"("organizationId", "nome", "idioma");
