import * as fs from 'fs';
import * as path from 'path';

/**
 * Coerencia dos metadados de todo @Module do projeto.
 *
 * POR QUE ESTE TESTE EXISTE: o build e os testes de unidade passaram com o app
 * quebrado em producao. `nest build` so checa tipos, e os testes de unidade
 * instanciam os services na mao — nenhum dos dois monta o grafo de injecao.
 * O erro ("cannot export a provider that is not part of this module") so
 * aparecia quando o container subia, ou seja, no ar.
 *
 * Subir o AppModule inteiro aqui exigiria banco e credenciais. Em vez disso,
 * lemos os metadados que os decorators gravaram e verificamos a regra que o
 * Nest aplica em tempo de boot: tudo que um modulo EXPORTA precisa ser algo
 * que ele mesmo declara (provider/controller) ou um modulo que ele importa.
 */
describe('metadados dos modulos', () => {
  /** Percorre src/ atras de *.module.ts. */
  function arquivosDeModulo(dir: string, achados: string[] = []): string[] {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, item.name);
      if (item.isDirectory()) arquivosDeModulo(completo, achados);
      else if (item.name.endsWith('.module.ts')) achados.push(completo);
    }
    return achados;
  }

  const modulos = arquivosDeModulo(__dirname).flatMap((arquivo) => {
    const exportados = require(arquivo) as Record<string, unknown>;
    return Object.entries(exportados)
      .filter(([, valor]) => typeof valor === 'function')
      .map(([nome, classe]) => ({
        nome,
        classe: classe as new (...args: unknown[]) => unknown,
        arquivo: path.relative(__dirname, arquivo),
      }));
  });

  it('encontra os modulos do projeto', () => {
    // Guarda contra o teste passar por nao ter varrido nada.
    expect(modulos.length).toBeGreaterThan(10);
  });

  it.each(modulos.map((m) => [m.nome, m] as const))(
    '%s exporta apenas o que declara ou importa',
    (_nome, modulo) => {
      const ler = (chave: string): unknown[] =>
        (Reflect.getMetadata(chave, modulo.classe) as unknown[]) ?? [];

      const disponivel = new Set<unknown>([
        ...ler('providers'),
        ...ler('controllers'),
        ...ler('imports'),
      ]);

      for (const exportado of ler('exports')) {
        // `forwardRef` e providers customizados ({ provide, useValue }) nao sao
        // classes; a checagem estatica nao alcanca esses casos.
        if (typeof exportado !== 'function') continue;

        expect({
          modulo: modulo.nome,
          arquivo: modulo.arquivo,
          exporta: exportado.name,
          declarado: disponivel.has(exportado),
        }).toEqual(
          expect.objectContaining({ declarado: true }),
        );
      }
    },
  );
});
