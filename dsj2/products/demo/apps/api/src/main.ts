import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { Module, HttpException } from "@nestjs/common";
import { json as bodyJson } from "express";
import type { Response, NextFunction } from "express";
import { allowedRoute, PRODUCT_POLICY } from "@demo/contracts/src/policy";
import { LIMITS } from "@demo/contracts";
import { DemoController } from "./controller";
import { authenticate } from "./auth";
import { db, type DemoRequest } from "./core";
@Module({ controllers: [DemoController] })
class DemoModule {}
export async function bootstrap() {
  if (PRODUCT_POLICY.productId !== "DEMO" || PRODUCT_POLICY.version !== 1)
    throw new Error("PRODUCT_MANIFEST_INVALID");
  const app = await NestFactory.create(DemoModule, {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  app.use((req: DemoRequest, res: Response, next: NextFunction) => {
    req.correlationId = randomUUID();
    res.setHeader("X-Correlation-ID", req.correlationId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (!allowedRoute("api", req.method, req.originalUrl, req.headers)) {
      res.status(404).json({
        code: "NOT_FOUND",
        message: "Не найдено",
        correlationId: req.correlationId,
      });
      return;
    }
    next();
  });
  app.use(bodyJson({ limit: LIMITS.jsonBytes, strict: true }));
  app.use((req: DemoRequest, res: Response, next: NextFunction) => {
    void authenticate(req, res, next);
  });
  app.use(
    (error: unknown, req: DemoRequest, res: Response, next: NextFunction) => {
      if (!error) {
        next();
        return;
      }
      const status =
        error instanceof HttpException
          ? error.getStatus()
          : (error as { status?: number })?.status || 500;
      const payload =
        error instanceof HttpException
          ? error.getResponse()
          : {
              code: status === 413 ? "PAYLOAD_TOO_LARGE" : "SERVICE_ERROR",
              message:
                status === 413
                  ? "Запрос превышает допустимый размер"
                  : "Сервис временно недоступен",
            };
      res.status(status).json({
        ...(typeof payload === "object" ? payload : { message: payload }),
        correlationId: req.correlationId,
      });
    },
  );
  app.useGlobalFilters({
    catch(error: unknown, host) {
      const http = host.switchToHttp();
      const req = http.getRequest<DemoRequest>();
      const res = http.getResponse<Response>();
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const payload =
        error instanceof HttpException
          ? error.getResponse()
          : {
              code: "SERVICE_ERROR",
              message:
                "Не удалось выполнить операцию. Сообщите код ошибки администратору",
            };
      if (status >= 500)
        console.error(
          JSON.stringify({
            level: "error",
            code: "REQUEST_FAILED",
            correlationId: req.correlationId,
          }),
        );
      res.status(status).json({
        ...(typeof payload === "object" ? payload : { message: payload }),
        correlationId: req.correlationId,
      });
    },
  });
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT || 4100),
    process.env.HOST || "127.0.0.1",
  );
  const close = async () => {
    await app.close();
    await db.$disconnect();
  };
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
  return app;
}
if (require.main === module)
  bootstrap().catch(() => {
    console.error(JSON.stringify({ level: "error", code: "API_START_FAILED" }));
    process.exitCode = 1;
  });
