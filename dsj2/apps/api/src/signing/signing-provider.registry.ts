import { randomUUID } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { LegalSigningProvider } from "@dsj/types";
import type { CreateProviderSessionInput } from "./signing.types";
import { EgovMobileQrSigningProvider } from "./providers/egov-mobile-qr-signing.provider";

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function trim(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

@Injectable()
export class SigningProviderRegistry {
  constructor(
    private readonly configService: ConfigService,
    private readonly egovMobileQrProvider: EgovMobileQrSigningProvider,
  ) {}

  normalizeProvider(value?: string | null): LegalSigningProvider {
    const raw =
      value ??
      this.configService.get<string>("SIGNING_PROVIDER_DEFAULT") ??
      this.configService.get<string>("SIGNING_PROVIDER") ??
      "MOCK_PROVIDER";
    const normalized = raw.trim().toUpperCase();

    if (normalized === "MOCK" || normalized === "MOCK_NCALAYER") {
      return "MOCK_PROVIDER";
    }

    if (normalized === "NCALAYER") {
      return "NCALAYER_PROVIDER";
    }

    if (
      normalized === "MOCK_PROVIDER" ||
      normalized === "NCALAYER_PROVIDER" ||
      normalized === "EGOV_MOBILE_QR_PROVIDER" ||
      normalized === "TABLET_SIGNATURE_PROVIDER"
    ) {
      return normalized;
    }

    throw new ServiceUnavailableException("Signing provider is not supported.");
  }

  assertProviderEnabled(provider: LegalSigningProvider) {
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";
    const requireLegalProvider = parseBoolean(
      this.configService.get<string>("SIGNING_REQUIRE_LEGAL_PROVIDER_IN_PROD"),
      true,
    );

    if (isProduction && requireLegalProvider && provider === "MOCK_PROVIDER") {
      throw new ServiceUnavailableException("Mock signing is disabled in production.");
    }

    if (provider === "MOCK_PROVIDER") {
      const enabled = parseBoolean(
        this.configService.get<string>("SIGNING_MOCK_ENABLED"),
        !isProduction,
      );

      if (!enabled) {
        throw new ServiceUnavailableException("Mock signing provider is disabled.");
      }
    }

    if (provider === "NCALAYER_PROVIDER") {
      const enabled = parseBoolean(this.configService.get<string>("NCALAYER_ENABLED"), true);

      if (!enabled) {
        throw new ServiceUnavailableException("NCALayer provider is disabled.");
      }
    }

    if (provider === "EGOV_MOBILE_QR_PROVIDER") {
      const enabled = parseBoolean(
        this.configService.get<string>("EGOV_MOBILE_QR_ENABLED"),
        false,
      );

      if (!enabled) {
        throw new ServiceUnavailableException("eGov Mobile QR provider is disabled.");
      }

      if (isProduction) {
        const baseUrl = trim(this.configService.get<string>("EGOV_MOBILE_QR_BASE_URL"));
        const clientId = trim(this.configService.get<string>("EGOV_MOBILE_QR_CLIENT_ID"));
        const clientSecret = trim(
          this.configService.get<string>("EGOV_MOBILE_QR_CLIENT_SECRET"),
        );
        const callbackUrl = trim(
          this.configService.get<string>("EGOV_MOBILE_QR_CALLBACK_URL"),
        );
        const callbackSecret = trim(
          this.configService.get<string>("EGOV_MOBILE_QR_CALLBACK_SECRET"),
        );

        if (!baseUrl || !clientId || !clientSecret || !callbackUrl || !callbackSecret) {
          throw new ServiceUnavailableException(
            "eGov Mobile QR provider is missing required production configuration.",
          );
        }
      }
    }

    if (provider === "TABLET_SIGNATURE_PROVIDER") {
      const enabled = parseBoolean(
        this.configService.get<string>("TABLET_SIGNATURE_ENABLED"),
        !isProduction,
      );

      if (!enabled) {
        throw new ServiceUnavailableException("Подпись на планшете отключена.");
      }
    }
  }

  async createProviderSession(input: CreateProviderSessionInput) {
    this.assertProviderEnabled(input.provider);

    if (input.provider === "EGOV_MOBILE_QR_PROVIDER") {
      return this.egovMobileQrProvider.createSigningSession(input);
    }

    if (input.provider === "TABLET_SIGNATURE_PROVIDER") {
      return {
        status: "WAITING_FOR_USER" as const,
        providerSessionId: `tablet-${randomUUID()}`,
        providerPublicJson: {
          pollAfterMs: 1500,
          documentHash: input.target.documentHash,
        },
      };
    }

    return {
      status: "WAITING_FOR_USER" as const,
      providerSessionId: `${input.provider.toLowerCase()}-${randomUUID()}`,
      providerPublicJson: {
        pollAfterMs: input.provider === "NCALAYER_PROVIDER" ? 1000 : 1500,
        documentHash: input.target.documentHash,
      },
    };
  }
}
