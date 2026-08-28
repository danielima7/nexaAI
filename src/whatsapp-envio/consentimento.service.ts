import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Situação de um contato em relação ao envio. */
export interface SituacaoContato {
  /**
   * A empresa pode INICIAR uma conversa com este contato?
   *
   * É o regime mais exigente: exige consentimento ativo e registrado.
   */
  autorizado: boolean;
  /** A janela de 24h desde a última mensagem dele está aberta? */
  janelaAberta: boolean;
  /** Frase pronta para explicar ao cliente quando não dá para enviar. */
  motivo?: string;
}

/**
 * Registro de quem autorizou receber mensagem no WhatsApp.
 *
 * A politica do WhatsApp e literal: so e permitido escrever para quem forneceu
 * o numero E autorizou o contato. Este service e o que torna essa regra
 * verificavel — sem ele, "temos consentimento" e uma afirmacao sem lastro, e a
 * consequencia documentada do descumprimento e o encerramento da conta.
 *
 * A JANELA DE 24 HORAS tambem mora aqui, porque depende do mesmo registro:
 * dentro de 24h da ultima mensagem do contato, a empresa responde livremente;
 * fora dela, so template aprovado. Sao dois regimes com regras diferentes, e
 * quem envia precisa saber em qual esta ANTES de escrever.
 */
@Injectable()
export class ConsentimentoService {
  private readonly logger = new Logger(ConsentimentoService.name);

  /** Duração da janela de resposta livre, em horas. Definida pela plataforma. */
  static readonly JANELA_HORAS = 24;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deixa o telefone só com dígitos, no formato que a API espera.
   *
   * O cliente digita "(24) 99999-8888", cola "+55 24 99999 8888" ou traz da
   * planilha com ponto. Sem normalizar, o mesmo contato vira três registros e
   * um deles seria consultado no envio enquanto a revogação está em outro.
   */
  static normalizar(telefone: string): string {
    return String(telefone ?? '').replace(/\D/g, '');
  }

  /** Registra a autorização. `origem` descreve COMO ela foi obtida. */
  async registrar(
    organizationId: string,
    dados: { telefone: string; origem: string; nome?: string },
  ): Promise<{ ok: boolean; motivo: string }> {
    const telefone = ConsentimentoService.normalizar(dados.telefone);

    // 10 dígitos = fixo com DDD; 13 = 55 + DDD + 9 dígitos. Fora disso é erro
    // de digitação, e um número errado autorizado é um número errado recebendo.
    if (telefone.length < 10 || telefone.length > 15) {
      return {
        ok: false,
        motivo: `"${dados.telefone}" não parece um telefone válido. Use o formato com DDD, por exemplo 24999998888.`,
      };
    }

    const origem = String(dados.origem ?? '').trim();
    if (origem.length < 5) {
      return {
        ok: false,
        motivo:
          'Descreva como a pessoa autorizou o contato (ex: "marcou a caixa no formulário de pedido em 03/09"). ' +
          'Esse registro é o que comprova o consentimento se a Meta ou o próprio cliente perguntarem.',
      };
    }

    await this.prisma.consentimentoWhatsapp.upsert({
      where: { organizationId_telefone: { organizationId, telefone } },
      create: { organizationId, telefone, nome: dados.nome, origem },
      // Reautorizar depois de revogar é possível — a pessoa mudou de ideia —
      // mas exige origem nova, porque é um consentimento novo.
      update: {
        status: 'ativo',
        origem,
        nome: dados.nome,
        revogadoEm: null,
        consentidoEm: new Date(),
      },
    });

    this.logger.log(`Consentimento registrado para ${telefone} (org ${organizationId}).`);
    return { ok: true, motivo: `${telefone} autorizado a receber mensagens.` };
  }

  /** Revoga. Nunca apaga: a prova de que o pedido foi respeitado também conta. */
  async revogar(organizationId: string, telefone: string): Promise<void> {
    const alvo = ConsentimentoService.normalizar(telefone);

    await this.prisma.consentimentoWhatsapp.upsert({
      where: { organizationId_telefone: { organizationId, telefone: alvo } },
      create: {
        organizationId,
        telefone: alvo,
        status: 'revogado',
        origem: 'revogado antes de qualquer registro de consentimento',
        revogadoEm: new Date(),
      },
      update: { status: 'revogado', revogadoEm: new Date() },
    });

    this.logger.log(`Consentimento revogado para ${alvo} (org ${organizationId}).`);
  }

  /**
   * Marca que o contato ESCREVEU para a empresa.
   *
   * Abre a janela de 24h. Chamado pelo webhook a cada mensagem recebida — é o
   * único momento em que a plataforma nos diz que a pessoa quis falar.
   *
   * QUEM ESCREVE PRIMEIRO JÁ CONSENTIU. A pessoa forneceu o número (mandou dele)
   * e pediu contato (escreveu). Por isso aqui é upsert, e não update: se
   * exigíssemos cadastro prévio, um cliente novo mandando "bom dia" ficaria sem
   * resposta — o oposto do que a regra existe para proteger.
   *
   * Quem revogou continua revogado. A janela abre (respondemos quem perguntou),
   * mas o status não volta sozinho para ativo: sair de uma lista de divulgação e
   * voltar a receber divulgação são decisões diferentes, e só a pessoa toma a
   * segunda.
   */
  async registrarEntrada(organizationId: string, telefone: string): Promise<void> {
    const alvo = ConsentimentoService.normalizar(telefone);
    const agora = new Date();

    await this.prisma.consentimentoWhatsapp.upsert({
      where: { organizationId_telefone: { organizationId, telefone: alvo } },
      create: {
        organizationId,
        telefone: alvo,
        status: 'ativo',
        origem: `iniciou a conversa no WhatsApp em ${agora.toLocaleDateString('pt-BR')}`,
        consentidoEm: agora,
        ultimaEntradaEm: agora,
      },
      update: { ultimaEntradaEm: agora },
    });
  }

  /** Pode enviar para este contato agora, e sob qual regime? */
  async situacao(
    organizationId: string,
    telefone: string,
  ): Promise<SituacaoContato> {
    const alvo = ConsentimentoService.normalizar(telefone);

    const reg = await this.prisma.consentimentoWhatsapp.findUnique({
      where: { organizationId_telefone: { organizationId, telefone: alvo } },
    });

    if (!reg) {
      return {
        autorizado: false,
        janelaAberta: false,
        motivo:
          `Não há autorização registrada para ${alvo}. O WhatsApp só permite ` +
          'escrever para quem forneceu o número e autorizou o contato — registre ' +
          'o consentimento antes, dizendo como ele foi obtido.',
      };
    }

    const janelaAberta =
      !!reg.ultimaEntradaEm &&
      Date.now() - reg.ultimaEntradaEm.getTime() <
        ConsentimentoService.JANELA_HORAS * 3600_000;

    // Revogado bloqueia a empresa de INICIAR conversa. A janela continua sendo
    // reportada de propósito: se a pessoa voltar a escrever, responder a ela é
    // atendimento, não divulgacao — e recusar seria tratar um pedido de "pare de
    // me mandar promocao" como "nunca mais fale comigo".
    if (reg.status === 'revogado') {
      return {
        autorizado: false,
        janelaAberta,
        motivo: `${alvo} pediu para não receber mais mensagens. Não envie campanhas nem avisos para este número.`,
      };
    }

    return { autorizado: true, janelaAberta };
  }

  /** Quantos contatos autorizados a organização tem. */
  async resumo(organizationId: string) {
    const [ativos, revogados] = await Promise.all([
      this.prisma.consentimentoWhatsapp.count({
        where: { organizationId, status: 'ativo' },
      }),
      this.prisma.consentimentoWhatsapp.count({
        where: { organizationId, status: 'revogado' },
      }),
    ]);
    return { ativos, revogados };
  }
}
