
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  //Để sử dụng validate chúng ta add middleware ở đây
  app.useGlobalPipes(new ValidationPipe())

  await app.listen(port, '0.0.0.0');
}
bootstrap();
