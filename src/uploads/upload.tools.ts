import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolContext } from '../tools/tool.interface';
import { UploadService } from './upload.service';

/**
 * Ferramentas de leitura das planilhas que o cliente enviou pelo chat.
 *
 * O conteudo NAO entra no historico da conversa — fica no banco e a IA le sob
 * demanda. Injetar a planilha inteira em toda mensagem estouraria a janela de
 * contexto e cobraria o arquivo de novo a cada pergunta.
 */
@Injectable()
export class UploadTools implements OnModuleInit {
  private readonly logger = new Logger(UploadTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly uploads: UploadService,
  ) {}

  private semOrganizacao(): string {
    return 'Nao consegui identificar sua organizacao.';
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'arquivo_ler',
        description:
          'Le o conteudo de uma planilha que o usuario enviou pelo chat (Excel ou CSV). Use SEMPRE que ele perguntar sobre "a planilha", "o arquivo" ou "a tabela que mandei". Sem informar o nome, le o arquivo mais recente.',
        input_schema: {
          type: 'object',
          properties: {
            nome: {
              type: 'string',
              description:
                'Parte do nome do arquivo. Omita para usar o mais recente.',
            },
          },
        },
      },
      execute: async (input, context: ToolContext | undefined) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const arquivo = await this.uploads.achar(
          context.organizationId,
          input?.nome,
        );
        if (!arquivo) {
          return input?.nome
            ? `Nao encontrei nenhum arquivo com "${input.nome}" no nome. Peca a lista de arquivos enviados.`
            : 'Nenhuma planilha foi enviada ainda. O usuario pode anexar um arquivo Excel ou CSV no chat pelo botao de anexo.';
        }

        return [
          `Planilha "${arquivo.nomeArquivo}" (${arquivo.totalLinhas} linhas, enviada em ${arquivo.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}):`,
          '',
          arquivo.conteudo,
        ].join('\n');
      },
    });

    this.registry.register({
      definition: {
        name: 'arquivo_listar',
        description:
          'Lista as planilhas que o usuario enviou pelo chat. Use quando ele perguntar quais arquivos mandou ou quiser escolher entre eles.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context: ToolContext | undefined) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const arquivos = await this.uploads.listar(context.organizationId);
        if (arquivos.length === 0) {
          return 'Nenhuma planilha enviada ainda. Use o botao de anexo no chat para mandar um Excel ou CSV.';
        }

        return [
          `Planilhas enviadas (${arquivos.length}):`,
          ...arquivos.map(
            (a) =>
              `- ${a.nomeArquivo} — ${a.totalLinhas} linhas — ${a.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
          ),
        ].join('\n');
      },
    });
  }
}
