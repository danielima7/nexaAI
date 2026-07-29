import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolContext } from '../tools/tool.interface';
import { ReportScheduleService } from './report-schedule.service';

/**
 * Ferramentas de configuracao do resumo diario.
 *
 * De proposito NAO existe uma ferramenta "enviar resumo agora": o resumo e
 * gerado pela propria IA, entao uma ferramenta que o dispara poderia ser
 * chamada pela IA *durante* a geracao do resumo — recursao infinita. Quem
 * quiser o resumo fora de hora simplesmente pede ("me faz um resumo do dia"),
 * e a IA monta na hora com as mesmas ferramentas.
 */
@Injectable()
export class ReportTools implements OnModuleInit {
  private readonly logger = new Logger(ReportTools.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly agenda: ReportScheduleService,
  ) {}

  private semOrganizacao(): string {
    return 'Nao consegui identificar sua organizacao.';
  }

  private descrever(schedule: {
    enabled: boolean;
    hour: number;
    minute: number;
    focus: string | null;
    channel: string;
    emailTo: string | null;
    lastSentAt: Date | null;
  }): string {
    const horario = this.agenda.formatarHorario(schedule.hour, schedule.minute);
    const porOnde =
      schedule.channel === 'whatsapp'
        ? 'por WhatsApp'
        : `por e-mail${schedule.emailTo ? ` para ${schedule.emailTo}` : ''}`;

    const linhas = [
      schedule.enabled
        ? `Resumo diario ATIVO, todo dia as ${horario}, ${porOnde}.`
        : `Resumo diario DESATIVADO (estava marcado para ${horario}, ${porOnde}).`,
    ];
    if (schedule.focus) linhas.push(`Foco pedido: ${schedule.focus}`);
    if (schedule.lastSentAt) {
      linhas.push(
        `Ultimo envio: ${schedule.lastSentAt.toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        })}`,
      );
    }
    return linhas.join('\n');
  }

  onModuleInit(): void {
    this.registry.register({
      definition: {
        name: 'kyrius_resumo_diario_status',
        description:
          'Mostra se o resumo diario automatico esta ativo, em que horario e com qual foco. Use quando o usuario perguntar sobre o resumo/relatorio diario ou quiser saber se esta configurado.',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (_input, context: ToolContext | undefined) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const schedule = await this.agenda.get(context.organizationId);
        if (!schedule) {
          return 'O resumo diario ainda nao foi configurado. Posso ativar: basta dizer o horario (ex: "ative o resumo diario as 8h").';
        }
        return this.descrever(schedule);
      },
    });

    this.registry.register({
      definition: {
        name: 'kyrius_configurar_resumo_diario',
        description:
          'Ativa, desativa ou ajusta o resumo diario automatico que o Kyrius envia sozinho pelo WhatsApp. Use quando o usuario pedir para receber um resumo/relatorio todo dia, mudar o horario, ou parar de receber.',
        input_schema: {
          type: 'object',
          properties: {
            ativar: {
              type: 'boolean',
              description:
                'true para ativar o envio automatico, false para desativar',
            },
            horario: {
              type: 'string',
              description:
                'Horario do envio no formato 24h, ex: "08:00" ou "18:30" (fuso de Sao Paulo)',
            },
            foco: {
              type: 'string',
              description:
                'O que o usuario quer que o resumo destaque, ex: "inadimplentes e boletos". Envie string vazia para remover o foco.',
            },
            canal: {
              type: 'string',
              enum: ['email', 'whatsapp'],
              description:
                'Por onde entregar o resumo. Padrao "email" (usa a conta Google conectada). "whatsapp" exige numero ativo.',
            },
            email: {
              type: 'string',
              description:
                'E-mail de destino, se diferente do e-mail da conta de acesso.',
            },
          },
        },
      },
      execute: async (input, context: ToolContext | undefined) => {
        if (!context?.organizationId) return this.semOrganizacao();

        const dados: {
          enabled?: boolean;
          hour?: number;
          minute?: number;
          focus?: string | null;
          channel?: string;
          emailTo?: string | null;
        } = {};

        if (typeof input?.ativar === 'boolean') dados.enabled = input.ativar;

        if (input?.canal === 'email' || input?.canal === 'whatsapp') {
          dados.channel = input.canal;
        }

        if (typeof input?.email === 'string') {
          dados.emailTo = input.email.trim() || null;
        }

        if (input?.horario) {
          const horario = this.agenda.interpretarHorario(input.horario);
          if (!horario) {
            return `Nao entendi o horario "${input.horario}". Use o formato 24h, por exemplo "08:00".`;
          }
          dados.hour = horario.hour;
          dados.minute = horario.minute;
        }

        if (typeof input?.foco === 'string') {
          dados.focus = input.foco.trim() || null;
        }

        if (Object.keys(dados).length === 0) {
          return 'Nao entendi o que mudar. Diga o horario, ou se quer ativar/desativar o resumo diario.';
        }

        // Ajustar o horario sem dizer nada sobre ativar significa querer receber.
        if (dados.enabled === undefined && dados.hour !== undefined) {
          dados.enabled = true;
        }

        const schedule = await this.agenda.set(context.organizationId, dados);
        this.logger.log(
          `Resumo diario atualizado para a organizacao ${context.organizationId}.`,
        );
        return this.descrever(schedule);
      },
    });
  }
}
