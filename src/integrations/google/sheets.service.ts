import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { GoogleService } from './google.service';

/** Uma planilha localizada no Drive do usuario. */
export interface PlanilhaResumo {
  id: string;
  nome: string;
  modificadaEm?: string;
}

/** Uma aba (worksheet) dentro de uma planilha. */
export interface AbaResumo {
  nome: string;
  linhas?: number;
  colunas?: number;
}

/**
 * Service de Planilhas (Google Sheets + descoberta via Google Drive).
 *
 * Reutiliza o consentimento OAuth do GoogleService: a organizacao autoriza o
 * Google uma unica vez e ganha Gmail, Agenda e Planilhas. Todo metodo recebe
 * o refreshToken da organizacao (multi-tenant), nunca le credencial do .env.
 */
@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  /** Teto de linhas devolvidas numa leitura (protege custo de token da IA). */
  static readonly MAX_LINHAS = 200;

  constructor(private readonly google: GoogleService) {}

  private sheets(refreshToken: string) {
    return google.sheets({
      version: 'v4',
      auth: this.google.authorizedClient(refreshToken),
    });
  }

  private drive(refreshToken: string) {
    return google.drive({
      version: 'v3',
      auth: this.google.authorizedClient(refreshToken),
    });
  }

  /**
   * Aceita tanto o ID puro quanto a URL completa da planilha — o dono da PME
   * normalmente cola o link do navegador.
   */
  static extrairId(idOuUrl: string): string {
    const m = String(idOuUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(idOuUrl).trim();
  }

  /**
   * Escapa aspas simples para uso seguro dentro da query do Drive
   * (evita quebrar a busca quando o nome tem apostrofo).
   */
  private static escaparQuery(valor: string): string {
    return valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /** Lista as planilhas do Drive do usuario, opcionalmente filtrando por nome. */
  async listarPlanilhas(
    refreshToken: string,
    nome?: string,
    limite = 20,
  ): Promise<PlanilhaResumo[]> {
    const filtros = [
      "mimeType='application/vnd.google-apps.spreadsheet'",
      'trashed=false',
    ];
    if (nome) {
      filtros.push(`name contains '${SheetsService.escaparQuery(nome)}'`);
    }
    const res = await this.drive(refreshToken).files.list({
      q: filtros.join(' and '),
      fields: 'files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: limite,
    });
    return (res.data.files ?? []).map((f) => ({
      id: f.id as string,
      nome: f.name ?? '(sem nome)',
      modificadaEm: f.modifiedTime ?? undefined,
    }));
  }

  /** Lista as abas de uma planilha (a IA precisa saber o nome da aba). */
  async listarAbas(
    refreshToken: string,
    planilhaId: string,
  ): Promise<{ titulo: string; abas: AbaResumo[] }> {
    const res = await this.sheets(refreshToken).spreadsheets.get({
      spreadsheetId: SheetsService.extrairId(planilhaId),
      fields: 'properties.title,sheets.properties(title,gridProperties)',
    });
    const abas = (res.data.sheets ?? []).map((s) => ({
      nome: s.properties?.title ?? '(sem nome)',
      linhas: s.properties?.gridProperties?.rowCount ?? undefined,
      colunas: s.properties?.gridProperties?.columnCount ?? undefined,
    }));
    return { titulo: res.data.properties?.title ?? '(sem titulo)', abas };
  }

  /**
   * Le um intervalo. `intervalo` aceita notacao A1 ("Vendas!A1:E50") ou apenas
   * o nome da aba ("Vendas") para trazer tudo o que estiver preenchido.
   */
  async lerIntervalo(
    refreshToken: string,
    planilhaId: string,
    intervalo: string,
    limite = 50,
  ): Promise<{ valores: string[][]; truncado: boolean; total: number }> {
    const res = await this.sheets(refreshToken).spreadsheets.values.get({
      spreadsheetId: SheetsService.extrairId(planilhaId),
      range: intervalo,
    });
    const todas = (res.data.values ?? []) as string[][];
    const teto = Math.min(limite, SheetsService.MAX_LINHAS);
    return {
      valores: todas.slice(0, teto),
      truncado: todas.length > teto,
      total: todas.length,
    };
  }

  /**
   * Acrescenta uma linha ao final da aba. Caso de uso principal da PME:
   * "registra a venda de R$ 500 do cliente Joao".
   *
   * USER_ENTERED faz o Sheets interpretar numeros, datas e formulas como se
   * tivessem sido digitados na interface (e nao como texto puro).
   */
  async adicionarLinha(
    refreshToken: string,
    planilhaId: string,
    intervalo: string,
    valores: (string | number)[],
  ): Promise<string> {
    const res = await this.sheets(refreshToken).spreadsheets.values.append({
      spreadsheetId: SheetsService.extrairId(planilhaId),
      range: intervalo,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [valores] },
    });
    return res.data.updates?.updatedRange ?? intervalo;
  }

  /** Atualiza uma celula ou intervalo com os valores informados. */
  async atualizarIntervalo(
    refreshToken: string,
    planilhaId: string,
    intervalo: string,
    valores: (string | number)[][],
  ): Promise<number> {
    const res = await this.sheets(refreshToken).spreadsheets.values.update({
      spreadsheetId: SheetsService.extrairId(planilhaId),
      range: intervalo,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores },
    });
    return res.data.updatedCells ?? 0;
  }

  /** Cria uma planilha nova, opcionalmente ja com a linha de cabecalho. */
  async criarPlanilha(
    refreshToken: string,
    titulo: string,
    cabecalho?: string[],
  ): Promise<{ id: string; url: string }> {
    const api = this.sheets(refreshToken);
    const res = await api.spreadsheets.create({
      requestBody: { properties: { title: titulo } },
    });
    const id = res.data.spreadsheetId as string;

    if (cabecalho?.length) {
      await api.spreadsheets.values.update({
        spreadsheetId: id,
        range: 'A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [cabecalho] },
      });
    }

    return {
      id,
      url:
        res.data.spreadsheetUrl ??
        `https://docs.google.com/spreadsheets/d/${id}`,
    };
  }
}
