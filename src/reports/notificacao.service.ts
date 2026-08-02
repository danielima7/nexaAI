import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { GoogleService } from '../integrations/google/google.service';
import { SuporteService } from '../suporte/suporte.service';

/**
 * Entrega de avisos proativos ao dono da organizacao (resumo diario, alertas).
 *
 * Usa a conta Google que a organizacao ja autorizou para as planilhas: o
 * e-mail sai dela para ela mesma. Isso evita provedor transacional, dominio
 * verificado e custo — e a entrega e perfeita, porque o remetente e o proprio
 * destinatario.
 */
@Injectable()
export class NotificacaoService {
  private readonly logger = new Logger(NotificacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly google: GoogleService,
    private readonly suporte: SuporteService,
  ) {}

  /** E-mail da primeira conta de acesso da organizacao. */
  async emailDaOrganizacao(
    organizationId: string,
  ): Promise<string | undefined> {
    const usuarios = await this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return usuarios.find((u) => !!u.email)?.email ?? undefined;
  }

  /**
   * Envia um e-mail pela conta Google da organizacao.
   * Lanca com mensagem clara quando falta destino ou autorizacao — quem chama
   * decide se registra a falha ou tenta de novo depois.
   */
  async enviarEmail(
    organizationId: string,
    assunto: string,
    texto: string,
    destinoPreferido?: string | null,
  ): Promise<string> {
    const para =
      destinoPreferido?.trim() || (await this.emailDaOrganizacao(organizationId));

    if (!para) {
      throw new Error(
        'Nenhum e-mail de destino: a organizacao nao tem conta de acesso nem e-mail configurado.',
      );
    }

    const refreshToken = await this.connections.resolveToken(
      { organizationId },
      'google',
      'GOOGLE_REFRESH_TOKEN',
    );
    if (!refreshToken) {
      throw new Error(
        'O Google nao esta conectado para esta organizacao — necessario para enviar e-mail.',
      );
    }

    // O rodape de suporte entra aqui, e nao em quem monta a mensagem, para
    // valer em TODO aviso proativo — resumo diario e alertas — sem depender
    // de cada chamador lembrar. Vazio quando nao ha numero configurado.
    const corpo = texto + this.suporte.rodapeEmail();

    await this.google.sendEmail(refreshToken, para, assunto, corpo);
    this.logger.log(`E-mail "${assunto}" enviado para ${para}.`);
    return para;
  }
}
