import { randomUUID } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CreateProviderSessionInput } from "../signing.types";
import type { EgovMobileQrProviderSession, EgovMobileQrTransport } from "./egov-mobile-qr.types";

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

@Injectable()
export class EgovMobileQrTransportFactory {
  constructor(private readonly configService: ConfigService) {}

  create(): EgovMobileQrTransport {
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";
    const localSimulation =
      !isProduction && parseBoolean(this.configService.get<string>("EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION"));

    return localSimulation ? new LocalEgovMobileQrTransport() : new OfficialEgovMobileQrTransport();
  }
}

class LocalEgovMobileQrTransport implements EgovMobileQrTransport {
  async createSession(input: CreateProviderSessionInput): Promise<EgovMobileQrProviderSession> {
    const providerSessionId = `egov-local-${randomUUID()}`;
    const qrValue = `dsj-egov-mock://sign/${encodeURIComponent(providerSessionId)}?correlationId=${encodeURIComponent(input.correlationId)}`;

    return {
      status: "QR_GENERATED",
      providerSessionId,
      providerPublicJson: {
        qrUrl: qrValue,
        deeplink: qrValue,
        pollAfterMs: 1500,
        expiresAt: input.expiresAt.toISOString(),
        localSimulation: true,
      },
    };
  }
}

class OfficialEgovMobileQrTransport implements EgovMobileQrTransport {
  async createSession(_input: CreateProviderSessionInput): Promise<EgovMobileQrProviderSession> {
    throw new ServiceUnavailableException({
      code: "EGOV_MOBILE_QR_TECHNICAL_PASSPORT_REQUIRED",
      message: "Официальный transport Smart Bridge не активирован: требуется технический паспорт NITEC-S-5096.",
      details: {
        requiredContractFields: [
          "точный endpoint создания QR-сессии",
          "формат и схема запроса",
          "алгоритм авторизации запроса",
          "поля ответа с providerSessionId, QR и deeplink",
          "формат, подпись и алгоритм проверки callback",
          "формат CMS и правила проверки сертификата",
          "коды статусов и ошибок провайдера",
        ],
      },
    });
  }
}
