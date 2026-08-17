import { ConfigService } from '@nestjs/config';
import { AsaasService } from './asaas.service';

/**
 * A combinacao chave/host errada NAO da erro obvio no Asaas: da saldo zero e
 * "nenhuma cobranca encontrada". O cliente veria o financeiro dele vazio e
 * acreditaria. Por isso a recusa e explicita.
 */
describe('AsaasService — coerencia entre chave e ambiente', () => {
  const CHAVE_HMLG = '$aact_hmlg_000abc';
  const CHAVE_PROD = '$aact_prod_000abc';
  const HOST_PROD = 'https://api.asaas.com/v3';

  function servico(baseUrl?: string) {
    return new AsaasService({
      get: () => baseUrl,
    } as unknown as ConfigService);
  }

  /** Dispara o caminho que resolve a base (o http() e privado). */
  const usar = (s: AsaasService, chave: string) =>
    (s as unknown as { http: (k: string) => unknown }).http(chave);

  it('aceita homologacao com o host de homologacao', () => {
    expect(() => usar(servico(undefined), CHAVE_HMLG)).not.toThrow();
    expect(() => usar(servico(AsaasService.BASE_SANDBOX), CHAVE_HMLG)).not.toThrow();
  });

  it('aceita producao com o host de producao', () => {
    expect(() => usar(servico(HOST_PROD), CHAVE_PROD)).not.toThrow();
  });

  it('recusa chave de producao no host de homologacao', () => {
    expect(() => usar(servico(AsaasService.BASE_SANDBOX), CHAVE_PROD)).toThrow(
      /mal configurada/i,
    );
  });

  it('recusa chave de homologacao no host de producao', () => {
    // O caso que quebraria ao trocar so a URL e esquecer a chave.
    expect(() => usar(servico(HOST_PROD), CHAVE_HMLG)).toThrow(/mal configurada/i);
  });

  it('reconhece as DUAS formas de host de homologacao', () => {
    // A documentacao atual do Asaas usa `api-sandbox.asaas.com/v3`; o nosso
    // padrao herdado usa `sandbox.asaas.com/api/v3`. As duas respondem, e a
    // guarda precisa aceitar ambas — senao trocar para a URL nova da
    // documentacao faria a integracao recusar uma configuracao correta.
    const nova = 'https://api-sandbox.asaas.com/v3';

    expect(() => usar(servico(nova), CHAVE_HMLG)).not.toThrow();
    expect(() => usar(servico(nova), CHAVE_PROD)).toThrow(/mal configurada/i);
  });

  it('o padrao sem configuracao e homologacao', () => {
    // Errar para sandbox nao move dinheiro de ninguem.
    expect(AsaasService.BASE_SANDBOX).toContain('sandbox');
    expect(() => usar(servico(undefined), CHAVE_PROD)).toThrow();
  });
});
