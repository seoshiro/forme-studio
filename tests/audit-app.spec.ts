import { test, expect } from "@playwright/test";

test("unavailable project ends loading and offers recovery", async ({
  page,
}) => {
  await page.goto("/#/project/missing-collection/board");
  await expect(page.getByRole("alert")).toContainText("Коллекция не найдена");
  await expect(page.locator(".loading-state")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Выбрать коллекцию", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Выбрать коллекцию", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("archive import error remains actionable inside the open dialog", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await page.getByLabel("Импорт архива FORME", { exact: true }).setInputFiles({
    name: "broken.forme",
    mimeType: "application/zip",
    buffer: Buffer.from("invalid zip"),
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Закрыть сообщение об ошибке", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test("closing a replacement dialog returns focus to the connected studio trigger", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Открыть студию",
    exact: true,
  });
  await trigger.click();
  await page
    .getByRole("button", { name: "Новая коллекция", exact: true })
    .click();
  await expect(
    page.getByLabel("Название коллекции", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("selected palette keeps a distinct visible keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Design kit", exact: true }).click();
  const swatch = page.locator(".palette-strip button").first();
  await swatch.click();
  await page.getByRole("combobox").first().focus();
  const ring = () =>
    swatch.evaluate((el) => {
      const style = getComputedStyle(el);
      return [
        style.outlineColor,
        style.outlineWidth,
        style.outlineOffset,
        style.boxShadow,
      ];
    });
  const selected = await ring();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(swatch).toBeFocused();
  expect(await swatch.evaluate((el) => el.matches(":focus-visible"))).toBe(
    true,
  );
  expect(await ring()).not.toEqual(selected);
});

test("read-only library inspection does not promise editing or saving", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  const viewer = await context.newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator(".notice")).toContainText("доступен просмотр");
  await viewer
    .getByRole("button", { name: /^Просмотреть находку:/ })
    .first()
    .click();
  const dialog = viewer.getByRole("dialog");
  await expect(dialog).toContainText("Режим просмотра");
  await expect(
    dialog.getByRole("button", { name: "Сохранить находку", exact: true }),
  ).toBeDisabled();
  const title = dialog.getByRole("textbox", { name: "Название", exact: true });
  await expect(title).not.toBeEditable();
  await title.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await viewer.close();
});
