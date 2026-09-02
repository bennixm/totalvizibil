import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<AppConfig, true>);

  app.setGlobalPrefix('api/v1');
  // Simple-site image uploads arrive as base64 data-URIs in the JSON body.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '12mb' }));
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: config.get('frontendOrigin', { infer: true }),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const port = config.get('port', { infer: true });
  await app.listen(port);
  Logger.log(`Totalvizibil API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
