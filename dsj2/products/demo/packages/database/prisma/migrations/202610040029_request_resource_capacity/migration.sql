-- Resource capacity for the autonomous DEMO request. No rows or history change.
-- Match contracts LIMITS.rows and scripts/render/request_limits.py.
ALTER TABLE "PrintRequest" DROP CONSTRAINT "request_rows";
ALTER TABLE "PrintRequest" ADD CONSTRAINT "request_rows"
  CHECK ("itemCount" BETWEEN 0 AND 10000);
