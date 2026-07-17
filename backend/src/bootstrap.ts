import { INestApplication, ValidationPipe } from "@nestjs/common";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";

const DEFAULT_ORIGINS = "http://localhost:3002";

export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(
    new AllExceptionsFilter(),
    new PrismaExceptionFilter(),
  );

  const origins = (process.env.CORS_ORIGINS ?? DEFAULT_ORIGINS)
    .split(",")
    .map((s) => s.trim());

  app.enableCors({
    origin: origins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  return app;
}
