-- Expand only the autonomous DEMO request capacity. Existing rows stay intact.
ALTER TABLE "PrintRequest" DROP CONSTRAINT "request_rows";
ALTER TABLE "PrintRequest" ADD CONSTRAINT "request_rows"
  CHECK ("itemCount" BETWEEN 0 AND 250);
