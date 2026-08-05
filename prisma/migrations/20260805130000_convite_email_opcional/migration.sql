-- Convite passa a aceitar e-mail vazio (convite ABERTO): quem recebe o link
-- digita o proprio e-mail. Convites ja existentes continuam com o e-mail
-- preenchido e seguem funcionando como convites direcionados.
ALTER TABLE "Invite" ALTER COLUMN "email" DROP NOT NULL;
