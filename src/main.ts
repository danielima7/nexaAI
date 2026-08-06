import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // `rawBody` guarda o corpo original da requisicao. Necessario para validar a
  // assinatura HMAC dos webhooks da Meta: a assinatura e calculada sobre os
  // bytes exatos que eles enviaram, e o JSON reserializado nao bate.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Katalli backend rodando em http://localhost:${port}`);
}

bootstrap();
