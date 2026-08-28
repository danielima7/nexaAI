import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Catalogo de templates aprovados pela Meta.
 *
 * Fora da janela de 24h, o WhatsApp so aceita mensagem iniciada pela empresa se
 * ela usar um template previamente aprovado. Isso nao e uma boa pratica nossa:
 * a API RECUSA texto livre nessa situacao.
 *
 * Guardamos o corpo aqui, e nao apenas o nome cadastrado na Meta, por um motivo
 * pratico: assim da para mostrar a previa ao cliente e conferir a quantidade de
 * variaveis ANTES de enviar. Template com variavel faltando volta como erro da
 * API — quando ja nao ha o que corrigir na redacao.
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quantas variaveis o corpo espera.
   *
   * Conta marcadores DISTINTOS, nao ocorrencias: `{{1}}` repetido duas vezes no
   * texto continua sendo uma variavel só, e contar duas faria o envio recusar
   * um template correto.
   */
  static contarVariaveis(corpo: string): number {
    const marcadores = new Set(
      [...String(corpo ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]),
    );
    return marcadores.size;
  }

  /**
   * Confere se os marcadores sao 1..N sem buraco.
   *
   * A Meta numera as variaveis em sequencia. Um corpo com `{{1}}` e `{{3}}` e
   * recusado na aprovacao, e o erro dela nao diz qual numero faltou.
   */
  static sequenciaValida(corpo: string): boolean {
    const nums = [
      ...new Set(
        [...String(corpo ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])),
      ),
    ].sort((a, b) => a - b);

    return nums.every((n, i) => n === i + 1);
  }

  /** Cadastra ou atualiza um template no catalogo local. */
  async salvar(
    organizationId: string,
    dados: { nome: string; corpo: string; idioma?: string },
  ): Promise<{ ok: boolean; motivo: string }> {
    const nome = String(dados.nome ?? '').trim().toLowerCase();
    const corpo = String(dados.corpo ?? '').trim();
    const idioma = (dados.idioma ?? 'pt_BR').trim();

    // A Meta so aceita nome em minusculas, com numeros e sublinhado.
    if (!/^[a-z0-9_]{1,512}$/.test(nome)) {
      return {
        ok: false,
        motivo:
          'O nome do template só pode ter letras minúsculas, números e sublinhado ' +
          '(ex: lembrete_vencimento). É uma exigência da Meta, não nossa.',
      };
    }

    if (corpo.length < 10) {
      return { ok: false, motivo: 'O corpo do template está muito curto.' };
    }

    if (!TemplateService.sequenciaValida(corpo)) {
      return {
        ok: false,
        motivo:
          'As variáveis precisam ser numeradas em sequência a partir de {{1}}, sem pular número. ' +
          'A Meta recusa o template na aprovação e o erro dela não diz qual faltou.',
      };
    }

    const variaveis = TemplateService.contarVariaveis(corpo);

    await this.prisma.templateWhatsapp.upsert({
      where: { organizationId_nome_idioma: { organizationId, nome, idioma } },
      create: { organizationId, nome, idioma, corpo, variaveis },
      // Editar o corpo devolve o template para rascunho: qualquer mudanca de
      // texto exige nova aprovacao da Meta, e manter "aprovado" aqui faria o
      // envio tentar usar uma versao que la nao existe.
      update: { corpo, variaveis, status: 'rascunho' },
    });

    return {
      ok: true,
      motivo:
        `Template "${nome}" salvo com ${variaveis} variável(is). ` +
        'Ele precisa ser aprovado pela Meta antes de poder ser enviado.',
    };
  }

  /** Marca como aprovado depois que a Meta aprovou. */
  async marcarAprovado(
    organizationId: string,
    nome: string,
    idioma = 'pt_BR',
  ): Promise<boolean> {
    const r = await this.prisma.templateWhatsapp.updateMany({
      where: { organizationId, nome: nome.trim().toLowerCase(), idioma },
      data: { status: 'aprovado' },
    });
    return r.count > 0;
  }

  async listar(organizationId: string) {
    return this.prisma.templateWhatsapp.findMany({
      where: { organizationId },
      orderBy: { nome: 'asc' },
    });
  }

  /** Busca um template pronto para envio (aprovado e com variáveis certas). */
  async paraEnvio(
    organizationId: string,
    nome: string,
    valores: string[],
    idioma = 'pt_BR',
  ): Promise<{ ok: boolean; motivo: string; corpo?: string }> {
    const t = await this.prisma.templateWhatsapp.findUnique({
      where: {
        organizationId_nome_idioma: {
          organizationId,
          nome: nome.trim().toLowerCase(),
          idioma,
        },
      },
    });

    if (!t) {
      return { ok: false, motivo: `Não existe template chamado "${nome}".` };
    }

    if (t.status !== 'aprovado') {
      return {
        ok: false,
        motivo:
          `O template "${t.nome}" ainda não foi aprovado pela Meta (está como ${t.status}). ` +
          'Fora da janela de 24h, só template aprovado pode ser enviado.',
      };
    }

    if (valores.length !== t.variaveis) {
      return {
        ok: false,
        motivo:
          `O template "${t.nome}" espera ${t.variaveis} variável(is) e recebeu ${valores.length}. ` +
          'A Meta recusa o envio quando a contagem não bate.',
      };
    }

    return { ok: true, motivo: 'ok', corpo: TemplateService.preencher(t.corpo, valores) };
  }

  /** Substitui {{1}}, {{2}}… pelos valores — para prévia e para registro. */
  static preencher(corpo: string, valores: string[]): string {
    return corpo.replace(/\{\{(\d+)\}\}/g, (_m, n) => valores[Number(n) - 1] ?? '');
  }
}
