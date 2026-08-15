import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  Diagnostico,
  ValidadorConexoesService,
} from '../saude/validador-conexoes.service';
import { NotificacaoService } from './notificacao.service';

/** Uma organizacao com pelo menos uma credencial morta. */
interface Achado {
  organizationId: string;
  nome: string;
  quebradas: Diagnostico[];
}

/**
 * Confere todo dia se as autorizacoes dos clientes ainda funcionam.
 *
 * Por que existe: o refresh token do Google emitido com a tela de consentimento
 * em "Testing" expira em 7 dias — medido tres vezes nesta base. Quando ele
 * morre, o painel para de carregar e o resumo diario para de sair, mas nada
 * avisa: o cliente descobre olhando uma tela quebrada, e voce descobre pelo
 * cliente. Este monitor inverte essa ordem.
 *
 * Nao conserta nada, e nao tem como consertar: reautorizar exige a pessoa
 * clicando no consentimento do Google. O que ele faz e encurtar o tempo entre
 * "quebrou" e "eu fiquei sabendo".
 */
@Injectable()
export class MonitorConexoesService {
  private readonly logger = new Logger(MonitorConexoesService.name);

  /**
   * Dia do ultimo aviso (AAAA-MM-DD), por organizacao afetada.
   *
   * Em memoria e por dia: uma autorizacao morta continua morta ate alguem
   * reconectar, e avisar a cada verificacao encheria a caixa de entrada com o
   * mesmo recado. Reinicio limpa a trava — se ainda estiver quebrado, avisar
   * de novo e o comportamento certo.
   */
  private avisos = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly validador: ValidadorConexoesService,
    private readonly notificacao: NotificacaoService,
  ) {}

  private get destino(): string | undefined {
    return this.config.get<string>('OWNER_ORGANIZATION_ID')?.trim() || undefined;
  }

  /**
   * 07:40 no fuso de Sao Paulo.
   *
   * Depois da coleta de metricas (03:10) e antes do horario tipico do resumo
   * diario (08:00): se uma autorizacao caiu, voce fica sabendo ANTES do resumo
   * daquele cliente falhar.
   */
  @Cron('40 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async verificarDiariamente(): Promise<void> {
    try {
      await this.verificarTudo();
    } catch (erro: unknown) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao verificar conexoes: ${detalhe}`);
    }
  }

  /** Exposto separado do @Cron para rodar sob demanda e em teste. */
  async verificarTudo(): Promise<Achado[]> {
    const organizacoes = await this.prisma.organization.findMany({
      select: { id: true, name: true, demo: true },
    });

    const achados: Achado[] = [];

    for (const org of organizacoes) {
      // Organizacao de demonstracao usa credencial de placeholder: ela sempre
      // falharia, e um alerta que sempre dispara vira ruido.
      if (org.demo) continue;

      let diagnosticos: Diagnostico[];
      try {
        diagnosticos = await this.validador.verificarTodos(org.id);
      } catch (erro: unknown) {
        const d = erro instanceof Error ? erro.message : String(erro);
        this.logger.warn(`Nao consegui verificar a organizacao ${org.id}: ${d}`);
        continue;
      }

      // So `expirada` vira alerta. `indeterminada` e "nao sei", e mandar
      // e-mail por causa de rede instavel ensina voce a ignorar o aviso.
      const quebradas = diagnosticos.filter((d) => d.estado === 'expirada');
      if (quebradas.length > 0) {
        achados.push({ organizationId: org.id, nome: org.name, quebradas });
      }
    }

    if (achados.length > 0) await this.avisar(achados);
    else this.logger.log('Verificacao de conexoes: todas as autorizacoes de pe.');

    return achados;
  }

  private async avisar(achados: Achado[]): Promise<void> {
    const hoje = new Date().toISOString().slice(0, 10);
    const novos = achados.filter((a) => this.avisos.get(a.organizationId) !== hoje);
    if (novos.length === 0) return;

    for (const a of novos) {
      this.logger.warn(
        `Autorizacao quebrada em "${a.nome}": ${a.quebradas.map((q) => q.provedor).join(', ')}.`,
      );
      // Marca ANTES de enviar: falha no envio nao pode virar reenvio a cada
      // verificacao. O log acima ja registrou o essencial.
      this.avisos.set(a.organizationId, hoje);
    }

    const destino = this.destino;
    if (!destino) {
      this.logger.error(
        'OWNER_ORGANIZATION_ID nao configurado — o alerta de conexoes ficou so no log.',
      );
      return;
    }

    try {
      await this.notificacao.enviarEmail(
        destino,
        `[Katalli] ${novos.length} cliente(s) com integração desconectada`,
        this.montarTexto(novos),
      );
      this.logger.log('Alerta de conexoes enviado.');
    } catch (erro: unknown) {
      const d = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Nao foi possivel enviar o alerta de conexoes: ${d}`);
    }
  }

  private montarTexto(achados: Achado[]): string {
    const linhas: string[] = [
      'As integrações abaixo pararam de funcionar. Enquanto isso, o painel não',
      'carrega e o resumo diário não sai para esses clientes.',
      '',
    ];

    for (const a of achados) {
      linhas.push(`${a.nome}`);
      for (const q of a.quebradas) linhas.push(`  - ${q.provedor}: autorização expirada`);
      linhas.push('');
    }

    linhas.push(
      'O QUE FAZER',
      '  O cliente precisa reconectar: peça para ele abrir a página de',
      '  Integrações e clicar em Reconectar. Ninguém consegue fazer isso por',
      '  ele — o consentimento é dado na conta dele.',
      '',
      'SE ISSO ESTIVER SE REPETINDO TODA SEMANA',
      '  A tela de consentimento OAuth provavelmente está em "Testing" no Google',
      '  Cloud Console. Nesse modo o Google expira toda autorização em 7 dias,',
      '  e nenhuma mudança no Katalli contorna isso.',
      '  Console > APIs & Services > OAuth consent screen > Publish app.',
      '',
      'Este aviso é enviado uma vez por dia por cliente afetado.',
    );

    return linhas.join('\n');
  }
}
