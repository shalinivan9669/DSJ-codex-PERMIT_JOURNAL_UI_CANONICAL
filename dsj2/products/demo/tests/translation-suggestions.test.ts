import test from "node:test";
import assert from "node:assert/strict";
import { suggestTranslations } from "../apps/api/src/translation-suggestions";

test("translation suggestions require review and do not invent unknown text without a provider", async () => {
  const saved = process.env.DEMO_GOOGLE_TRANSLATE_API_KEY;
  delete process.env.DEMO_GOOGLE_TRANSLATE_API_KEY;
  try {
    const result = await suggestTranslations(
      {},
      {
        target: "en",
        texts: [
          { key: "positionRu", text: "Дизайнер" },
          { key: "trainingSubject", text: "Несуществующая программа 123" },
        ],
      },
    );
    assert.equal(result.reviewRequired, true);
    assert.equal(result.items[0].translation, "Designer");
    assert.equal(result.items[1].translation, "");
    assert.equal(result.missingCount, 1);
    assert.equal(result.providerConfigured, false);
  } finally {
    if (saved === undefined) delete process.env.DEMO_GOOGLE_TRANSLATE_API_KEY;
    else process.env.DEMO_GOOGLE_TRANSLATE_API_KEY = saved;
  }
});

test("translation endpoint accepts neither personal name keys nor a caller-supplied provider URL", async () => {
  await assert.rejects(
    suggestTranslations(
      {},
      { target: "en", texts: [{ key: "fullNameRu", text: "Иванов Иван" }] },
    ),
    /только должность/,
  );
  await assert.rejects(
    suggestTranslations(
      {},
      {
        target: "kk",
        texts: [{ key: "positionRu", text: "Дизайнер" }],
        url: "https://example.invalid",
      },
    ),
    /только должность/,
  );
});
