import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // `rawBody` guarda o corpo original da requisicao. Necessario para validar a
  // assinatura HMAC dos webhooks da Meta: a assinatura e calculada sobre os
  // bytes exatos que eles enviaram, e o JSON reserializado nao bate.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Confia em UM salto de proxy (Caddy em producao, ngrok em teste).
  //
  // Sem isto, `req.ip` devolve o IP do proxy e nao o do visitante — e todo
  // limite por origem passa a contar o mundo inteiro num balde so: um unico
  // atacante bloquearia o login de todos os clientes.
  //
  // O valor e 1, e nao `true`, de proposito: `true` confiaria na cadeia inteira
  // de X-Forwarded-For, que o proprio cliente pode forjar para escapar do
  // limite. Com 1, vale o endereco que o nosso proxy escreveu.
  app.set('trust proxy', 1);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Katalli backend rodando em http://localhost:${port}`);
}

bootstrap();
