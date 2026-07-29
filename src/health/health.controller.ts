import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Healthcheck para orquestradores (Docker, Kubernetes, load balancer) e para
 * monitoramento externo.
 *
 * Verifica o banco de proposito: um processo que responde HTTP mas nao alcanca
 * o Postgres esta inutil — todo pedido do usuario falharia. Melhor o
 * orquestrador reiniciar/despriorizar essa instancia do que servir erro.
 *
 * Nao exige autenticacao e nao expoe nada sensivel: apenas se esta de pe.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; banco: string; uptime: number }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // 503 e o codigo que orquestradores entendem como "nao me mande trafego".
      throw new HttpException(
        { status: 'erro', banco: 'inacessivel' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ok',
      banco: 'ok',
      uptime: Math.floor(process.uptime()),
    };
  }
}
