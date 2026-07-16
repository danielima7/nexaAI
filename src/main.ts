import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Nexa backend rodando em http://localhost:${port}`);
}

bootstrap();
