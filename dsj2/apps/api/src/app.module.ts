import { ProductBoundaryGuard } from "./common/guards/product-boundary.guard";
import { PrintingContextController } from "./printing/printing-context.controller";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { BiotCardsModule } from "./biot-cards/biot-cards.module";
import { RolesGuard } from "./common/guards/roles.guard";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PrismaModule } from "./database/prisma.module";
import { TranslationsModule } from "./translations/translations.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env.local", "../../.env"],
    }),
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    AuthModule,
    BiotCardsModule,
    TranslationsModule,
  ],
  controllers: [PrintingContextController],
  providers: [
    { provide: APP_GUARD, useClass: ProductBoundaryGuard },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
