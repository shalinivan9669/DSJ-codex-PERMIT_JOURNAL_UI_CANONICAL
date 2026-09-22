import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { validateSecurityConfig } from "./common/utils/security-preflight";
import { assertPrintingProduct } from "../../../product-policy/legacy";
import { legacyProductBoundary } from "./common/product-boundary.middleware";

function resolveAppUrl() {
  const trimmed = process.env.APP_URL?.trim();

  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is required in production.");
  }

  return "http://localhost:3000";
}

function resolveCorsOrigin(appUrl: string) {
  const trimmed = process.env.CORS_ORIGIN?.trim();

  if (trimmed) {
    const origins = trimmed
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean);

    return origins.length === 1 ? origins[0] : origins;
  }

  return appUrl;
}

async function bootstrap() {
  assertPrintingProduct();
  validateSecurityConfig();

  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 4000);
  const appUrl = resolveAppUrl();
  const corsOrigin = resolveCorsOrigin(appUrl);
  const logger = new Logger("Bootstrap");

  app.setGlobalPrefix("v1");
  // Raw URL boundary runs before CORS, controllers, Public and role bypasses.
  app.use(legacyProductBoundary(Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin]));
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  await app.listen(port);
  logger.log(`API listening on port ${port} with prefix /v1`);
}

bootstrap();
