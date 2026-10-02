import { HttpException } from "@nestjs/common";
import { z } from "@demo/contracts";

const inputSchema = z
  .object({
    target: z.enum(["kk", "en"]),
    texts: z
      .array(
        z
          .object({
            key: z.enum(["positionRu", "trainingSubject"]),
            text: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

// Starter terminology. Values are suggestions, never accepted fields.
const terms: Record<string, { kk: string; en: string }> = {
  маркетолог: { kk: "Маркетолог", en: "Marketing specialist" },
  дизайнер: { kk: "Дизайнер", en: "Designer" },
  инженер: { kk: "Инженер", en: "Engineer" },
  директор: { kk: "Директор", en: "Director" },
  менеджер: { kk: "Менеджер", en: "Manager" },
  бухгалтер: { kk: "Бухгалтер", en: "Accountant" },
  водитель: { kk: "Жүргізуші", en: "Driver" },
  электрик: { kk: "Электрик", en: "Electrician" },
  сварщик: { kk: "Дәнекерлеуші", en: "Welder" },
  слесарь: { kk: "Слесарь", en: "Fitter" },
  рабочий: { kk: "Жұмысшы", en: "Worker" },
  "безопасность и охрана труда": {
    kk: "Еңбек қауіпсіздігі және еңбекті қорғау",
    en: "Occupational safety and health",
  },
  "пожарно-технический минимум": {
    kk: "Өрт-техникалық минимум",
    en: "Fire safety training",
  },
  "промышленная безопасность": {
    kk: "Өнеркәсіптік қауіпсіздік",
    en: "Industrial safety",
  },
};

export async function suggestTranslations(_context: unknown, body: unknown) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpException(
      {
        code: "TRANSLATION_INPUT_INVALID",
        message:
          "Для перевода передаются только должность и программа обучения, до 20 полей.",
      },
      400,
    );
  const { target, texts } = parsed.data;
  const items = texts.map((entry) => ({
    key: entry.key,
    source: entry.text,
    translation:
      terms[entry.text.toLocaleLowerCase("ru").replace(/[«»".]+$/g, "")]?.[
        target
      ] || "",
    provider: "GLOSSARY",
  }));
  const missing = items.filter((item) => !item.translation);
  const key = process.env.DEMO_GOOGLE_TRANSLATE_API_KEY;
  if (missing.length && key) {
    let response: Response;
    try {
      // Fixed provider origin; user-supplied text cannot redirect this request.
      response = await fetch(
        "https://translation.googleapis.com/language/translate/v2",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            q: missing.map((item) => item.source),
            source: "ru",
            target,
            format: "text",
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
    } catch {
      throw new HttpException(
        {
          code: "TRANSLATION_UNAVAILABLE",
          message:
            "Сервис перевода недоступен. Повторите запрос или введите проверенный перевод вручную.",
        },
        503,
      );
    }
    if (!response.ok)
      throw new HttpException(
        {
          code: "TRANSLATION_PROVIDER_ERROR",
          message:
            "Сервис перевода не выполнил запрос. Проверьте подключение в настройках сервера.",
        },
        503,
      );
    const result = z
      .object({
        data: z.object({
          translations: z.array(
            z.object({ translatedText: z.string().trim().min(1).max(2000) }),
          ),
        }),
      })
      .safeParse(await response.json().catch(() => null));
    if (
      !result.success ||
      result.data.data.translations.length !== missing.length
    )
      throw new HttpException(
        {
          code: "TRANSLATION_RESPONSE_INVALID",
          message: "Не удалось проверить ответ сервиса перевода.",
        },
        502,
      );
    missing.forEach((item, index) => {
      item.translation = result.data.data.translations[index].translatedText;
      item.provider = "GOOGLE_TRANSLATE";
    });
  }
  return {
    items,
    reviewRequired: true,
    providerConfigured: !!key,
    missingCount: items.filter((item) => !item.translation).length,
  };
}
