import { z } from "zod";
import { customerSchema, organizationFormSchema } from "./organization";

export const registrationSchema = z
  .object({
    legalForm: organizationFormSchema,
    ownNameRu: z.string().trim().min(1, "Введите название центра").max(500),
    ownNameKz: z.string().trim().max(500).default(""),
    displayName: z
      .string()
      .trim()
      .min(1, "Введите имя администратора")
      .max(255),
    email: z
      .email()
      .max(255)
      .transform((value) => value.toLowerCase()),
    password: z
      .string()
      .min(12, "Пароль должен содержать не менее 12 символов")
      .max(256),
  })
  .strict()
  .superRefine((value, context) => {
    const names = customerSchema.safeParse({
      legalForm: value.legalForm,
      ownNameRu: value.ownNameRu,
      ownNameKz: value.ownNameKz,
    });
    if (!names.success)
      for (const issue of names.error.issues)
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
export type RegistrationInput = z.infer<typeof registrationSchema>;
