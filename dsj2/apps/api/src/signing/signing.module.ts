import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CorePlatformModule } from "../core-platform/core-platform.module";
import { EmployeeDocumentsModule } from "../employee-documents/employee-documents.module";
import { ProtocolsModule } from "../protocols/protocols.module";
import { ResponsibilityOrdersModule } from "../responsibility-orders/responsibility-orders.module";
import { SigningController } from "./signing.controller";
import { SigningProviderRegistry } from "./signing-provider.registry";
import { SigningService } from "./signing.service";
import { EgovMobileQrSigningProvider } from "./providers/egov-mobile-qr-signing.provider";
import { EgovMobileQrTransportFactory } from "./providers/egov-mobile-qr.transport";

@Module({
  imports: [
    AuditModule,
    CorePlatformModule,
    ProtocolsModule,
    ResponsibilityOrdersModule,
    EmployeeDocumentsModule,
  ],
  controllers: [SigningController],
  providers: [
    SigningService,
    SigningProviderRegistry,
    EgovMobileQrSigningProvider,
    EgovMobileQrTransportFactory,
  ],
  exports: [SigningService],
})
export class SigningModule {}
