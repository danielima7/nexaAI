-- Chat Web com login por organizacao.
-- whatsappPhone deixa de ser obrigatorio: quem entra so pelo chat nao tem numero.
ALTER TABLE "User" ALTER COLUMN "whatsappPhone" DROP NOT NULL;

-- Credenciais do Chat Web (senha guardada como hash scrypt, nunca em claro).
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
