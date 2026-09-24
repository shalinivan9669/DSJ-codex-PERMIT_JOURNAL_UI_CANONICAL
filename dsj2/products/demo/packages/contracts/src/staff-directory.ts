import { z } from "zod";

export const staffDirectorySchema = z
  .object({
    items: z.array(
      z.object({ id: z.string().uuid(), displayName: z.string() }).strict(),
    ),
  })
  .strict();

export type StaffDirectory = z.infer<typeof staffDirectorySchema>;
