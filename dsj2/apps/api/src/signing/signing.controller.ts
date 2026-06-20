import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  cancelSigningSessionSchema,
  completeLocalEgovSigningSessionSchema,
  createSigningSessionSchema,
  egovMobileQrCallbackSchema,
  signingDocumentTypeSchema,
  submitMockSigningSessionSchema,
  submitNcalayerSigningSessionSchema,
  submitTabletSigningSessionSchema,
} from "@dsj/types";
import type { Request } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { SigningService } from "./signing.service";

function requestContext(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get("user-agent") ?? null,
  };
}

@Controller()
export class SigningController {
  constructor(private readonly signingService: SigningService) {}

  @Post("signing/sessions")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "EMPLOYEE_SIGNER")
  async createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSigningSessionSchema))
    input: Parameters<SigningService["createSession"]>[1],
  ) {
    return this.signingService.createSession(user, input, idempotencyKey ?? null);
  }

  @Get("signing/sessions/:id")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "EMPLOYEE_SIGNER")
  async getSession(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.signingService.getSession(user, id);
  }

  @Post("signing/sessions/:id/cancel")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "EMPLOYEE_SIGNER")
  async cancelSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelSigningSessionSchema))
    input: Parameters<SigningService["cancelSession"]>[2],
  ) {
    return this.signingService.cancelSession(user, id, input);
  }

  @Post("signing/sessions/:id/mock/submit")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "EMPLOYEE_SIGNER")
  async submitMock(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(submitMockSigningSessionSchema))
    input: Parameters<SigningService["submitMock"]>[2],
  ) {
    return this.signingService.submitMock(user, id, input, requestContext(request));
  }

  @Post("signing/sessions/:id/ncalayer/submit")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "EMPLOYEE_SIGNER")
  async submitNcalayer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(submitNcalayerSigningSessionSchema))
    input: Parameters<SigningService["submitNcalayer"]>[2],
  ) {
    return this.signingService.submitNcalayer(user, id, input, requestContext(request));
  }

  @Post("signing/sessions/:id/tablet/submit")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER")
  async submitTablet(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(submitTabletSigningSessionSchema))
    input: Parameters<SigningService["submitTablet"]>[2],
  ) {
    return this.signingService.submitTablet(user, id, input, requestContext(request));
  }

  @Post("signing/sessions/:id/egov-local/complete")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER")
  async completeLocalEgov(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(completeLocalEgovSigningSessionSchema))
    input: Parameters<SigningService["completeLocalEgov"]>[2],
  ) {
    return this.signingService.completeLocalEgov(user, id, input);
  }

  @Post("signing/providers/egov-mobile-qr/callback")
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async acceptEgovCallback(
    @Headers("x-dsj-local-callback-secret") localCallbackSecret: string | undefined,
    @Headers("authorization") authorization: string | undefined,
    @Body(new ZodValidationPipe(egovMobileQrCallbackSchema))
    input: Parameters<SigningService["acceptEgovCallback"]>[0],
  ) {
    const bearer = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;
    return this.signingService.acceptEgovCallback(input, localCallbackSecret ?? bearer);
  }

  @Get("documents/:type/:id/signatures")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "EMPLOYEE_SIGNER")
  async listDocumentSignatures(
    @CurrentUser() user: AuthenticatedUser,
    @Param("type") type: string,
    @Param("id") id: string,
  ) {
    return this.signingService.listDocumentSignatures(
      user,
      signingDocumentTypeSchema.parse(type),
      id,
    );
  }

  @Get("documents/:type/:id/signing-state")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "EMPLOYEE_SIGNER")
  async getDocumentSigningState(
    @CurrentUser() user: AuthenticatedUser,
    @Param("type") type: string,
    @Param("id") id: string,
  ) {
    return this.signingService.getDocumentSigningState(
      user,
      signingDocumentTypeSchema.parse(type),
      id,
    );
  }
}
