/**
 * Configuracao dos testes automatizados.
 *
 * Foco em testes UNITARIOS das regras de seguranca — o que quebra em silencio
 * e so aparece quando ja e tarde: criptografia, sessao, convite de uso unico,
 * audiencia de ferramentas e o fallback de credenciais entre organizacoes.
 *
 * Sem banco e sem rede. A suite precisa ser rapida o bastante para rodar antes
 * de cada commit — uma suite lenta simplesmente deixa de ser executada, e teste
 * que ninguem roda nao protege nada.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!main.ts'],

  // Silencia os logs do Nest durante os testes (ver test-setup.ts).
  setupFilesAfterEnv: ['<rootDir>/test-setup.ts'],

  // `isolatedModules: true` fica no tsconfig.json e faz o ts-jest transpilar
  // sem re-checar tipos — o `npm run build` e o `npx tsc --noEmit` ja fazem
  // isso. Sem essa opcao, cada arquivo de teste re-typechecava o projeto
  // inteiro e a suite levava ~8 minutos em vez de ~6 segundos.
};
