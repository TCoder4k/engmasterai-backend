import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Backend chạy cổng 3000
  const port = process.env.PORT ?? 3000;
  // Cho phép frontend Vite (5174) gọi API

  app.enableCors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  });

  // Required to read the httpOnly refresh-token cookie (req.cookies) on
  // POST /auth/refresh and POST /auth/logout.
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe());

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Backend running on http://localhost:${port}`);
}

bootstrap();
