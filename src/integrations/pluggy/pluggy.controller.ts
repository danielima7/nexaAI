import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PluggyService } from './pluggy.service';
import { ConnectionsService } from '../../connections/connections.service';

/**
 * Rotas do fluxo de conexao de banco real (widget Pluggy Connect).
 *
 * Fluxo:
 *  1. Usuario abre /pluggy/connect?org=<orgId>
 *  2. Servimos o widget Pluggy Connect (o usuario escolhe o banco e autoriza
 *     no proprio banco via Open Finance)
 *  3. onSuccess -> /pluggy/store?org=<orgId>&itemId=<id> guarda a conexao da org
 */
@Controller('pluggy')
export class PluggyController {
  private readonly logger = new Logger(PluggyController.name);

  constructor(
    private readonly pluggy: PluggyService,
    private readonly connections: ConnectionsService,
  ) {}

  /** Extrai apenas o UUID de um valor (protege contra lixo, ex: "id**"). */
  private cleanOrg(raw?: string): string | undefined {
    if (!raw) return undefined;
    const m = raw.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    return m ? m[0] : undefined;
  }

  /** Serve a pagina com o widget Pluggy Connect. */
  @Get('connect')
  async connect(@Query('org') org: string, @Res() res: Response): Promise<void> {
    if (!this.pluggy.isConfigured()) {
      res.status(400).send('Pluggy nao configurado no servidor.');
      return;
    }
    const orgId = this.cleanOrg(org);
    if (!orgId) {
      res.status(400).send('Organizacao ausente ou invalida.');
      return;
    }
    try {
      const connectToken = await this.pluggy.createConnectToken();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Conectar banco — Katalli</title>
<script src="https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js"></script>
</head>
<body style="font-family:sans-serif;text-align:center;margin-top:60px">
<h2>Conectar seu banco ao Katalli</h2>
<p>Abrindo o seletor de bancos...</p>
<script>
  const pluggyConnect = new PluggyConnect({
    connectToken: ${JSON.stringify(connectToken)},
    includeSandbox: true,
    onSuccess: (itemData) => {
      const itemId = itemData && itemData.item && itemData.item.id;
      window.location.href = '/pluggy/store?org=${orgId}&itemId=' + itemId;
    },
    onError: (error) => {
      document.body.innerHTML = '<h2>Ocorreu um erro</h2><pre>' + JSON.stringify(error) + '</pre>';
    },
  });
  pluggyConnect.init();
</script>
</body></html>`);
    } catch (e: any) {
      const details = e?.response?.data ?? e?.message ?? e;
      this.logger.error(`Falha ao criar connect token: ${JSON.stringify(details)}`);
      res.status(500).send('Erro ao iniciar a conexao com o banco.');
    }
  }

  /** Recebe o itemId apos o sucesso do widget e guarda na organizacao. */
  @Get('store')
  async store(
    @Query('org') org: string,
    @Query('itemId') itemId: string,
    @Res() res: Response,
  ): Promise<void> {
    const orgId = this.cleanOrg(org);
    if (!orgId || !itemId) {
      res.status(400).send('Dados da conexao ausentes.');
      return;
    }
    await this.connections.set(orgId, 'pluggy', { itemId });
    this.logger.log(`Banco conectado para a organizacao ${orgId} (item ${itemId}).`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      `<html><body style="font-family:sans-serif;text-align:center;margin-top:60px">
        <h2>✅ Banco conectado!</h2>
        <p>Sua conta foi conectada ao Katalli. Pode fechar esta pagina e voltar ao WhatsApp.</p>
        <p>A sincronizacao leva alguns segundos. Depois pergunte seu saldo ou extrato.</p>
      </body></html>`,
    );
  }
}
