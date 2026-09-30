import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("three independent demos load twelve local photos and editable copies", async ({
  page,
}) => {
  await page.goto("/");
  const ids: string[] = [];
  for (const name of [
    "Тихая архитектура",
    "Предметы и свет",
    "Город после дождя",
  ]) {
    await page.locator(".demo-card").filter({ hasText: name }).click();
    await expect(page.locator(".board-scene img")).toHaveCount(4);
    await expect
      .poll(async () =>
        page
          .locator(".board-scene img")
          .evaluateAll((images) =>
            images.every((i) => (i as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    ids.push(new URL(page.url()).hash.split("/")[2]);
    await expect(page.locator(".save-status")).toContainText("Сохранено");
    await page
      .getByRole("button", { name: "FORME — на главную", exact: true })
      .click();
  }
  expect(new Set(ids).size).toBe(3);
  await page
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await expect(page.locator(".project-list>button")).toHaveCount(3);
});
test("empty, long title, no results, dropped file, error and edge dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая коллекция", exact: true })
    .click();
  await page
    .getByLabel("Название коллекции", { exact: true })
    .fill(
      "Коллекция с очень длинным названием, которое должно оставаться читаемым и не ломать интерфейс",
    );
  await page
    .getByRole("button", { name: "Создать коллекцию", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "У каждой идеи есть первая находка" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Добавить изображения", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "docs/qa/empty-mobile.png", fullPage: true });
  const bytes = await fs.readFile("public/images/photo-6.jpg");
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], "Находка.jpg", {
          type: "image/jpeg",
        }),
      );
      return transfer;
    },
    [...bytes],
  );
  await page.locator(".app").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".material-card")).toHaveCount(1);
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  await page.getByLabel("Поиск по тексту и тегам").fill("невозможный-запрос");
  await expect(
    page.getByRole("heading", { name: "Ничего не нашлось" }),
  ).toBeVisible();
  await expect(page.locator(".toast")).toBeHidden();
  await page.screenshot({
    path: "docs/qa/no-results-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Доска", exact: true }).click();
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await expect(page.getByLabel("Поиск по тексту и тегам")).toHaveValue(
    "невозможный-запрос",
  );
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles({
      name: "Ошибка.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Not an image</h1>"),
    });
  await expect(page.locator(".global-error")).toBeVisible();
  await expect(page.locator(".toast")).toBeHidden();
  await page.screenshot({
    path: "docs/qa/file-error-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Закрыть сообщение об ошибке" })
    .click();
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const box = (await page.getByRole("dialog").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "docs/qa/export-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Экспорт", exact: true }),
  ).toBeFocused();
});
