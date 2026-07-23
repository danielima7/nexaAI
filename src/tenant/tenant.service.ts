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
}
