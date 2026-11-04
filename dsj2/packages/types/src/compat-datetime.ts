import { z } from "zod";
import { datetimeRegex } from "zod/v3";

// Match Zod 3's existing scalar datetime contract without using its collection parser.
const pattern = datetimeRegex({ offset: true, local: false, precision: null });
export const compatibleOffsetDateTime = () => z.string().regex(pattern, "Invalid datetime");
