import { type Page } from "@playwright/test";

/** Standalone validation is a secondary request-menu action; transfer validates itself. */
export async function validateRequestFromMenu(page: Page) {
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Прочее", exact: true })
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
}
