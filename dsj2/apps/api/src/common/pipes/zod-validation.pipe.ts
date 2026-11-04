import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodIssue, ZodSchema } from "zod";

function formatCharacterCount(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${value} символ`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${value} символа`;
  }

  return `${value} символов`;
}

function formatIssue(issue: ZodIssue) {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) {
        return "Поле обязательно.";
      }

      return issue.message;
    case "too_small":
      if (issue.origin === "string") {
        return `Минимум ${formatCharacterCount(Number(issue.minimum))}.`;
      }

      return issue.message;
    case "too_big":
      if (issue.origin === "string") {
        return `Максимум ${formatCharacterCount(Number(issue.maximum))}.`;
      }

      return issue.message;
    case "invalid_format":
      if (issue.format === "email") {
        return "Некорректный email.";
      }

      return issue.message;
    case "invalid_value":
      return "Недопустимое значение.";
    default:
      return issue.message || "Ошибка валидации.";
  }
}

@Injectable()
export class ZodValidationPipe<TSchema> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<TSchema>) {}

  transform(value: unknown) {
    const parsed = this.schema.safeParse(value, { reportInput: true });

    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      const messages = parsed.error.issues.map((issue) => {
        const path = issue.path.join(".");
        const message = formatIssue(issue);

        return path ? `${path}: ${message}` : message;
      });

      throw new BadRequestException({
        message: messages.length ? messages : ["Ошибка валидации"],
        issues: flattened,
      });
    }

    return parsed.data;
  }
}
