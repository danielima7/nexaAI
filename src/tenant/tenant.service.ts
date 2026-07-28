import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Organization, User } from '@prisma/client';

/**
 * Resolve (ou cria) a organizacao e o usuario a partir do numero de WhatsApp.
 *
 * Fase 1 do multi-tenant: cada numero novo vira automaticamente um usuario
 * de uma nova organizacao. No futuro (onboarding real), a criacao passara a
 * ser controlada — vincular um numero a uma organizacao existente, etc.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna o usuario (com sua organizacao) para o numero informado,
   * criando ambos na primeira vez que o numero aparece.
   */
  async resolveByWhatsapp(
    phone: string,
  ): Promise<{ user: User; organization: Organization }> {
    const existing = await this.prisma.user.findUnique({
      where: { whatsappPhone: phone },
      include: { organization: true },
    });
    if (existing) {
      return { user: existing, organization: existing.organization };
    }

    // Primeiro contato: cria uma organizacao e um usuario para este numero.
    const organization = await this.prisma.organization.create({
      data: { name: `Organizacao ${phone}` },
    });
    const user = await this.prisma.user.create({
      data: { organizationId: organization.id, whatsappPhone: phone },
    });
    this.logger.log(
      `Novo tenant criado para ${phone}: org ${organization.id}, user ${user.id}`,
    );
    return { user, organization };
  }

  /**
   * Resolve o tenant a partir de uma organizacao JA CONHECIDA — usado pelo
   * Chat Web autenticado, onde a organizacao vem do token de sessao e nao de
   * um identificador escolhido pelo navegador.
   *
   * Diferenca importante para `resolveByWhatsapp`: aqui NAO se cria
   * organizacao. Se o id nao existir, devolve `null` — token valido apontando
   * para organizacao inexistente e erro, nao motivo para provisionar um tenant.
   */
  async resolveByOrganization(
    organizationId: string,
  ): Promise<{ user: User; organization: Organization } | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      this.logger.warn(
        `Organizacao ${organizationId} nao encontrada ao resolver o tenant do chat.`,
      );
      return null;
    }

    const existing = await this.prisma.user.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return { user: existing, organization };

    // Organizacao sem nenhum usuario: cria um usuario tecnico para que as
    // mensagens e os logs de operacao tenham a quem ser atribuidos.
    const user = await this.prisma.user.create({
      data: {
        organizationId,
        name: 'Usuario do Chat Web',
        whatsappPhone: `web-owner:${organizationId}`,
      },
    });
    this.logger.log(
      `Usuario tecnico criado para a organizacao ${organizationId}: ${user.id}`,
    );
    return { user, organization };
  }
}
