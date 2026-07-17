import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  await app.listen(3001);
  console.log("Backend running on http://localhost:3001");
}
bootstrap();
