-- Instrucoes do atendimento ao publico (Direct do Instagram).
-- Nulo/vazio mantem o atendimento publico desligado para a organizacao.
ALTER TABLE "Organization" ADD COLUMN "atendimentoInstrucoes" TEXT;
