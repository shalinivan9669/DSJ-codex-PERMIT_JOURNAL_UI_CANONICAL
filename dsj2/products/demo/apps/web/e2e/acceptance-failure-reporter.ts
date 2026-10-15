import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { stripVTControlCharacters } from "node:util";

/** Preserve immediate diagnostics without changing test outcomes or retries. */
export default class AcceptanceFailureReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    if (!["failed", "timedOut", "interrupted"].includes(result.status)) return;
    const redact = (input: string) => {
      let output = stripVTControlCharacters(input);
      for (const [name, value] of Object.entries(process.env))
        if (value && /PASSWORD|SECRET|TOKEN|COOKIE|DATABASE_URL/i.test(name))
          output = output.split(value).join("[REDACTED]");
      return output;
    };
    console.error(
      JSON.stringify({
        event: "acceptance.test_failed",
        title: test.titlePath().join(" > "),
        status: result.status,
        errors: result.errors.map((error) =>
          redact(error.message || error.stack || String(error)),
        ),
      }),
    );
  }
}
