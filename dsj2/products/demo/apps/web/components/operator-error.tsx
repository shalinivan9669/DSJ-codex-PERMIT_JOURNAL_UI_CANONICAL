"use client";

import { operatorErrorParts } from "@/lib/operator-error";
import { useCabinetLanguage } from "./cabinet-language";

export function OperatorError({ text }: { text: string }) {
  const t = useCabinetLanguage();
  const { message, correlationId } = operatorErrorParts(text);
  return (
    <>
      {message}
      {correlationId && (
        <details>
          <summary>
            {t("Данные для поддержки", "Қолдау қызметіне арналған деректер")}
          </summary>
          <code>{correlationId}</code>
        </details>
      )}
    </>
  );
}
