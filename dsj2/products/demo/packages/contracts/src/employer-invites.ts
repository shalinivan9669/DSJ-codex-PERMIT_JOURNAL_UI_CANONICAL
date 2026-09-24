import { z } from "zod";
export const employerInviteSchema = z
  .object({
    customerId: z.string().uuid(),
    email: z
      .email()
      .max(255)
      .transform((v) => v.toLowerCase()),
    displayName: z.string().trim().min(1).max(255),
    permissions: z
      .array(z.enum(["READ", "PROPOSE", "APPROVE_DATA", "DOWNLOAD"]))
      .min(1)
      .max(4)
      .refine((p) => p.includes("READ")),
    recipientIds: z.array(z.string().uuid()).max(1000).default([]),
    expiresAt: z.iso.datetime(),
    accessExpiresAt: z.iso.datetime(),
  })
  .strict();
export const employerInviteTokenSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const employerInviteExchangeSchema = employerInviteTokenSchema.extend({
  password: z.string().min(12).max(256),
});
