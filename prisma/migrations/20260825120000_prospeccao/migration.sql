-- Registro de quem ja recebeu contato de prospeccao.
--
-- Sem isto, prospeccao vira dano: contato repetido, gente que pediu para sair
-- continuando a receber, e nenhum controle de quantos e-mails sairam no dia.
CREATE TABLE "Prospecto" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "nome" TEXT,
  "empresa" TEXT,
  "origem" TEXT,
  "status" TEXT NOT NULL DEFAULT 'contatado',
  "contatadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "observacao" TEXT,

  CONSTRAINT "Prospecto_pkey" PRIMARY KEY ("id")
);

-- Um contato por organizacao. E restricao de BANCO de proposito: duplicar
-- abordagem e o erro que mais custa reputacao, e conferencia em codigo depende
-- de alguem lembrar de chamar.
CREATE UNIQUE INDEX "Prospecto_organizationId_email_key"
  ON "Prospecto"("organizationId", "email");

-- Consulta quente: quantos e-mails sairam hoje (o teto diario).
CREATE INDEX "Prospecto_organizationId_contatadoEm_idx"
  ON "Prospecto"("organizationId", "contatadoEm");
