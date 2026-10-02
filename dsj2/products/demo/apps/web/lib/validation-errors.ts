import { ApiError } from "./api";
import type { Validation } from "./types";

export function validationErrors(caught: unknown): Validation["errors"] {
  if (!(caught instanceof ApiError)) return [];
  const details = (caught.details as { details?: unknown } | undefined)
    ?.details;
  if (!Array.isArray(details)) return [];
  return details.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== "object" || !("message" in issue)) return [];
    const value = issue as {
      message: string;
      path?: string | (string | number)[];
      rowId?: string;
    };
    return [
      {
        message: value.message,
        path: (Array.isArray(value.path)
          ? value.path.join(".")
          : value.path || ""
        ).replace(/^draft\./, ""),
        itemId: value.rowId,
      },
    ];
  });
}
