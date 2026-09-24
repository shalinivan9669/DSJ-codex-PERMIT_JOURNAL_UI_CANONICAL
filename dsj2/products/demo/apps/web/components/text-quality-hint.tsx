import { textQualityHints } from "@/lib/text-quality";
export function TextQualityHint({ value }: { value: string }) {
  return (
    <>
      {textQualityHints(value).map((hint) => (
        <small className="field-hint" key={hint}>
          Проверка источника: {hint}
        </small>
      ))}
    </>
  );
}
