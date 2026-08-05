-- Autocadastro publico (/criar-conta).
--
-- `autocadastro` separa quem entrou sozinho de quem voce convidou.
-- `limiteInteracoes` e a trava de custo: NULL = sem teto (clientes de verdade),
-- numero = teto de mensagens no chat. Sem isso, uma rota publica de cadastro
-- deixaria a chave da Anthropic exposta a quem achasse a URL.
ALTER TABLE "Organization" ADD COLUMN "autocadastro" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "limiteInteracoes" INTEGER;
