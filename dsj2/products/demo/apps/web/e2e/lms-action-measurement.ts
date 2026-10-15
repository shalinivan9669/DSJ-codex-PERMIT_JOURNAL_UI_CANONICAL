import type { Page } from "@playwright/test";

type ActionKind =
  | "click"
  | "field"
  | "select"
  | "file"
  | "navigate"
  | "key"
  | "refresh";
export function measureLmsActions(
  page: Page,
  scenario: string,
  role: string,
  startBoundary: string,
  preconditions: string[],
) {
  const started = performance.now();
  let excludedMilliseconds = 0;
  let dialogs = 0;
  let applicationDialogs = 0;
  let visibleDialogs = 0;
  const dialogObserved = () => {
    dialogs++;
  };
  page.on("dialog", dialogObserved);
  const steps: Array<{
    kind: ActionKind;
    label: string;
    decision: boolean;
    confirmation: boolean;
    navigation: boolean;
    elapsedMilliseconds: number;
  }> = [];
  return {
    async action(
      kind: ActionKind,
      label: string,
      operation: () => Promise<unknown>,
      options: {
        decision?: boolean;
        confirmation?: boolean;
        navigation?: boolean;
      } = {},
    ) {
      const at = performance.now();
      await operation();
      const currentDialogs = await page
        .locator('[role="dialog"]:visible,dialog[open]')
        .count();
      applicationDialogs += Math.max(0, currentDialogs - visibleDialogs);
      visibleDialogs = currentDialogs;
      steps.push({
        kind,
        label,
        decision: !!options.decision,
        confirmation: !!options.confirmation,
        navigation: kind === "navigate" || !!options.navigation,
        elapsedMilliseconds: performance.now() - at,
      });
    },
    async exclude(operation: () => Promise<unknown>) {
      const at = performance.now();
      await operation();
      excludedMilliseconds += performance.now() - at;
    },
    finish(result: unknown) {
      page.off("dialog", dialogObserved);
      const count = (kind: ActionKind) =>
        steps.filter((step) => step.kind === kind).length;
      return {
        scenario,
        role,
        startBoundary,
        preconditions,
        steps,
        clicks: count("click"),
        keyboardActions: count("key"),
        fields: count("field"),
        repeatedFields: 0,
        selections: count("select"),
        decisions: steps.filter((step) => step.decision).length,
        navigation: steps.filter((step) => step.navigation).length,
        dialogs: dialogs + applicationDialogs,
        nativeDialogs: dialogs,
        applicationDialogs,
        confirmations: steps.filter((step) => step.confirmation).length,
        manualRefresh: count("refresh"),
        fileSelections: count("file"),
        nativeFilePickerObserved: false,
        elapsedMilliseconds: performance.now() - started - excludedMilliseconds,
        excludedVerificationMilliseconds: excludedMilliseconds,
        result,
        boundary:
          "Counts cover recorded application actions. fill/selectOption/setInputFiles are semantic field actions; native file-picker interactions and physical keystrokes inside fill are not claimed. Repeated fields means re-entry of values already known to the application in this scenario.",
      };
    },
  };
}
