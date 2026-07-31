import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';

/** Resultado da extracao, antes de virar registro. */
export interface PlanilhaExtraida {
  conteudo: string;
  totalLinhas: number;
  abas: string[];
}

/**
 * Leitura de planilhas enviadas pelo cliente no chat.
 *
 * POR QUE ISSO EXISTE: boa parte da PME brasileira nao usa Google Sheets — usa
 * um .xlsx no computador. Sem isso, esse cliente precisaria migrar de
 * ferramenta antes de conseguir usar o Kyrius.
 *
 * Guardamos apenas o TEXTO extraido, nunca o binario: e o que a IA le, ocupa
 * uma fracao do espaco, entra no backup normalmente e dispensa storage externo.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  /** Teto de linhas lidas por arquivo. */
  static readonly MAX_LINHAS = 200;

  /** Tamanho maximo aceito (bytes). */
  static readonly MAX_BYTES = 5 * 1024 * 1024;

  /** Extensoes aceitas. */
  static readonly EXTENSOES = ['.xlsx', '.xls', '.csv'];

  constructor(private readonly prisma: PrismaService) {}

  /** O arquivo tem extensao suportada? */
  extensaoValida(nome: string): boolean {
    const minusculo = nome.toLowerCase();
    return UploadService.EXTENSOES.some((e) => minusculo.endsWith(e));
  }

  /**
   * Converte a planilha em texto tabular.
   *
   * Le todas as abas, mas trunca no total de linhas: uma planilha de 5 mil
   * linhas estouraria a janela de contexto e queimaria custo de token sem
   * ajudar — o dono quer a resposta, nao o arquivo inteiro de volta.
   */
  extrair(buffer: Buffer): PlanilhaExtraida {
    const livro = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    const partes: string[] = [];
    let totalLinhas = 0;
    let restante = UploadService.MAX_LINHAS;

    for (const nomeAba of livro.SheetNames) {
      const aba = livro.Sheets[nomeAba];
      const linhas: any[][] = XLSX.utils.sheet_to_json(aba, {
        header: 1,
        blankrows: false,
        defval: '',
      });

      totalLinhas += linhas.length;
      if (restante <= 0) continue;

      const recorte = linhas.slice(0, restante);
      restante -= recorte.length;

      if (recorte.length === 0) continue;

      partes.push(
        `--- Aba "${nomeAba}" (${linhas.length} linhas) ---`,
        ...recorte.map((linha) =>
          linha.map((celula) => this.formatarCelula(celula)).join(' | '),
        ),
      );
    }

    if (partes.length === 0) {
      throw new Error('A planilha esta vazia ou nao pode ser lida.');
    }

    if (totalLinhas > UploadService.MAX_LINHAS) {
      partes.push(
        `\n(Mostrando as primeiras ${UploadService.MAX_LINHAS} linhas de ${totalLinhas}.)`,
      );
    }

    return {
      conteudo: partes.join('\n'),
      totalLinhas,
      abas: livro.SheetNames,
    };
  }

  /** Datas viram formato brasileiro; o resto vira texto simples. */
  private formatarCelula(valor: any): string {
    if (valor instanceof Date) return valor.toLocaleDateString('pt-BR');
    return String(valor ?? '');
  }

  /** Guarda o conteudo extraido. */
  async salvar(params: {
    organizationId: string;
    userId?: string;
    nomeArquivo: string;
    extraida: PlanilhaExtraida;
  }) {
    const registro = await this.prisma.upload.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        nomeArquivo: params.nomeArquivo,
        conteudo: params.extraida.conteudo,
        totalLinhas: params.extraida.totalLinhas,
      },
    });

    this.logger.log(
      `Planilha "${params.nomeArquivo}" recebida (${params.extraida.totalLinhas} linhas, organizacao ${params.organizationId}).`,
    );
    return registro;
  }

  /** Arquivos enviados pela organizacao, do mais recente para o mais antigo. */
  async listar(organizationId: string, limite = 10) {
    return this.prisma.upload.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limite,
    });
  }

  /**
   * Acha um arquivo pelo nome (parcial, sem diferenciar maiusculas).
   * Sem nome, devolve o mais recente — que e o caso comum: o cliente acabou de
   * enviar e pergunta em seguida.
   */
  async achar(organizationId: string, nome?: string) {
    if (!nome?.trim()) {
      return this.prisma.upload.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
    }

    const arquivos = await this.listar(organizationId, 50);
    const busca = nome.trim().toLowerCase();
    return (
      arquivos.find((a) => a.nomeArquivo.toLowerCase().includes(busca)) ?? null
    );
  }
}
