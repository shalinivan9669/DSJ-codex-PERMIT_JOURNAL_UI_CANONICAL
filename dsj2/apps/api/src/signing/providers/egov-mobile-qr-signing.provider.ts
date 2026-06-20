import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hashDocumentPayload } from "@dsj/utils";
import type { CreateProviderSessionInput } from "../signing.types";
import { EgovMobileQrTransportFactory } from "./egov-mobile-qr.transport";
import type { VerifiedEgovMobileQrSignature, VerifyEgovCallbackInput } from "./egov-mobile-qr.types";

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function required(value: string | undefined, field: string) {
  if (!value) {
    throw new BadRequestException(`Локальный eGov callback не содержит поле ${field}.`);
  }

  return value;
}

@Injectable()
export class EgovMobileQrSigningProvider {
  constructor(
    private readonly configService: ConfigService,
    private readonly transportFactory: EgovMobileQrTransportFactory,
  ) {}

  createSigningSession(input: CreateProviderSessionInput) {
    return this.transportFactory.create().createSession(input);
  }

  assertCallbackAuthorized(callbackSecret?: string | null, expectedCallbackSecret?: string | null) {
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";
    const localSimulation =
      !isProduction && parseBoolean(this.configService.get<string>("EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION"));

    if (!localSimulation) {
      throw new ServiceUnavailableException({
        code: "EGOV_MOBILE_QR_CALLBACK_CONTRACT_REQUIRED",
        message:
          "Проверка production callback Smart Bridge недоступна без официального технического паспорта NITEC-S-5096.",
      });
    }

    const expectedSecret = expectedCallbackSecret?.trim();
    if (expectedSecret && callbackSecret !== expectedSecret) {
      throw new UnauthorizedException("Неверная авторизация eGov callback.");
    }
  }

  verifyCallback(input: VerifyEgovCallbackInput): VerifiedEgovMobileQrSignature {
    this.assertCallbackAuthorized(input.callbackSecret, input.expectedCallbackSecret);

    const callback = input.callback;
    if (callback.providerSessionId !== input.expectedProviderSessionId) {
      throw new BadRequestException("providerSessionId callback не совпадает с сессией.");
    }

    if (callback.correlationId !== input.expectedCorrelationId) {
      throw new BadRequestException("correlationId callback не совпадает с сессией.");
    }

    if (callback.documentHash?.toLowerCase() !== input.expectedDocumentHash.toLowerCase()) {
      throw new BadRequestException("Подписанный documentHash не совпадает с версией документа.");
    }

    const signedAtValue = required(callback.signedAt, "signedAt");
    const validFromValue = required(callback.certificateValidFrom, "certificateValidFrom");
    const validToValue = required(callback.certificateValidTo, "certificateValidTo");
    const signedAt = new Date(signedAtValue);
    const validFrom = new Date(validFromValue);
    const validTo = new Date(validToValue);

    if (Number.isNaN(signedAt.getTime()) || Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
      throw new BadRequestException("Callback содержит некорректный срок сертификата.");
    }

    if (signedAt < validFrom || signedAt > validTo || Date.now() > validTo.getTime()) {
      throw new BadRequestException("Сертификат недействителен на момент проверки подписи.");
    }

    const signaturePayload = required(callback.signaturePayload, "signaturePayload");

    return {
      signerName: required(callback.signerName, "signerName"),
      signerIin: required(callback.signerIin, "signerIin"),
      certificateSerial: required(callback.certificateSerial, "certificateSerial"),
      certificateThumbprint: required(callback.certificateThumbprint, "certificateThumbprint"),
      certificateSubject: required(callback.certificateSubject, "certificateSubject"),
      certificateIssuer: required(callback.certificateIssuer, "certificateIssuer"),
      certificateValidFrom: validFromValue,
      certificateValidTo: validToValue,
      signedAt: signedAtValue,
      documentHash: input.expectedDocumentHash,
      signaturePayloadHash: hashDocumentPayload(signaturePayload),
      verificationMode: "LOCAL_SIMULATION",
    };
  }
}
