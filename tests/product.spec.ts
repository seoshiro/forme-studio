import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
const root = process.cwd();
async function newProject(page: Page, name = "Проверка FORME") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая коллекция", exact: true })
    .click();
  await page.getByLabel("Название коллекции", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Создать коллекцию", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Место для того/ }),
  ).toBeVisible();
}
async function doc(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("forme-studio", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const id = location.hash.split("/")[2];
    return await new Promise<import("../src/model").BoardDocument>(
      (resolve, reject) => {
        const r = db.transaction("projects").objectStore("projects").get(id);
        r.onsuccess = () => {
          db.close();
          resolve(r.result);
        };
        r.onerror = () => reject(r.error);
      },
    );
  });
}
test("golden path: upload, edit, reload, real PNG and full archive in clean context", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:5180") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await newProject(page);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles(path.join(root, "public/images/photo-1.jpg"));
  await expect(page.locator(".material-card")).toHaveCount(1);
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  await page
    .getByRole("button", { name: "На доску: photo-1", exact: true })
    .click();
  await page.getByRole("button", { name: "Доска", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Объект: photo-1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Объект: photo-1", exact: true })
    .click();
  await page.getByLabel("X", { exact: true }).fill("240");
  await page.getByLabel("X", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await page
    .getByLabel("Текст заметки", { exact: true })
    .fill("Сохранить свет.\nИ пространство для идеи.");
  await page.getByLabel("Название объекта", { exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  const before = await doc(page);
  expect(before.objects).toHaveLength(2);
  expect(before.objects[0].x).toBe(240);
  await page.reload();
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  expect((await doc(page)).objects).toEqual(before.objects);
  await expect(page.locator(".board-scene img")).toBeVisible();
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Мудборд в PNG/ }).click();
  const png = await pngDownload;
  await fs.mkdir("docs/qa/exports", { recursive: true });
  await png.saveAs("docs/qa/exports/golden.png");
  const pngBytes = await fs.readFile("docs/qa/exports/golden.png");
  expect([...pngBytes.subarray(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(pngBytes.readUInt32BE(16)).toBe(1400);
  expect(pngBytes.readUInt32BE(20)).toBe(1000);
  expect(pngBytes.length).toBeGreaterThan(10000);
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Полный архив .forme/ }).click();
  const zip = await zipDownload;
  await zip.saveAs("docs/qa/exports/golden.forme");
  const context = await browser.newContext();
  const restored = await context.newPage();
  await restored.goto("/");
  await restored
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await restored
    .getByLabel("Импорт архива FORME", { exact: true })
    .setInputFiles(path.join(root, "docs/qa/exports/golden.forme"));
  await expect(restored.locator(".board-scene img")).toBeVisible();
  const after = await doc(restored);
  expect(after.id).not.toBe(before.id);
  expect(after.objects).toEqual(before.objects);
  expect(after.materials[0].blobId).not.toBe(before.materials[0].blobId);
  expect(
    await restored
      .locator(".board-scene img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await restored.reload();
  await expect(restored.locator(".board-scene img")).toBeVisible();
  await context.close();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toContainText("Сохранено");
}
async function openBoard(page: Page) {
  await page.getByRole("button", { name: "Доска", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Заметка", exact: true }),
  ).toBeEnabled();
}
test("editor gestures, one-step undo/redo, layers, duplicate, delete and input shortcuts", async ({
  page,
}) => {
  await newProject(page);
  await openBoard(page);
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await saved(page);
  const original = (await doc(page)).objects[0];
  const target = page.getByRole("button", {
    name: "Объект: Мысль на полях",
    exact: true,
  });
  const rect = (await target.boundingBox())!;
  await page.mouse.move(rect.x + 35, rect.y + 35);
  await page.mouse.down();
  await page.mouse.move(rect.x + 140, rect.y + 85, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  const moved = (await doc(page)).objects[0];
  expect(moved.x).not.toBe(original.x);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  expect((await doc(page)).objects[0]).toEqual(original);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await saved(page);
  expect((await doc(page)).objects[0]).toEqual(moved);
  const handle = page.locator(".resize-handle");
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 70, h.y + 45, { steps: 8 });
  await page.mouse.up();
  await saved(page);
  expect((await doc(page)).objects[0].width).toBeGreaterThan(moved.width);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  expect((await doc(page)).objects[0]).toEqual(moved);
  await page.getByLabel("Название объекта", { exact: true }).fill("Клавиатура");
  await page.getByLabel("Название объекта", { exact: true }).press("Delete");
  expect((await doc(page)).objects).toHaveLength(1);
  await page.getByLabel("Название объекта", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Дублировать", exact: true }).click();
  await saved(page);
  let d = await doc(page);
  expect(d.objects).toHaveLength(2);
  const copy = d.objects[1].id;
  await page.getByRole("button", { name: "Ниже", exact: true }).click();
  await saved(page);
  expect((await doc(page)).objects[0].id).toBe(copy);
  await page
    .getByRole("button", { name: "Удалить объект", exact: true })
    .click();
  await saved(page);
  expect((await doc(page)).objects).toHaveLength(1);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  expect((await doc(page)).objects).toHaveLength(2);
  await page.getByRole("button", { name: "Цвет", exact: true }).click();
  await saved(page);
  d = await doc(page);
  expect(d.objects.at(-1)?.type).toBe("swatch");
  expect(
    await page
      .getByRole("button", { name: "Повторить", exact: true })
      .isDisabled(),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Увеличить масштаб", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Перемещение области", exact: true })
    .click();
  const viewport = page.locator(".board-viewport");
  const b = (await viewport.boundingBox())!;
  await page.mouse.move(b.x + 15, b.y + 15);
  await page.mouse.down();
  await page.mouse.move(b.x + 70, b.y + 45);
  await page.mouse.up();
  expect(
    await page.locator(".board-center").getAttribute("style"),
  ).not.toContain("translate(0px,0px)");
  await page
    .getByRole("button", { name: "Вписать доску", exact: true })
    .click();
  await page.getByRole("button", { name: "Презентация", exact: true }).click();
  await expect(page.locator(".editor-sidebar")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-sidebar")).toBeVisible();
});
test("library metadata, search, favorites, bookmarks, palette roles and valid design kit", async ({
  page,
}) => {
  await newProject(page);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles([
      path.join(root, "public/images/photo-1.jpg"),
      path.join(root, "public/images/photo-5.jpg"),
    ]);
  await expect(page.locator(".material-card")).toHaveCount(2);
  await saved(page);
  await page
    .getByRole("button", {
      name: "Редактировать находку: photo-1",
      exact: true,
    })
    .click();
  await page.getByLabel("Название", { exact: true }).fill("Архитектурный свет");
  await page.getByLabel("Теги через запятую").fill("камень, свет");
  await page
    .getByRole("button", { name: "Сохранить находку", exact: true })
    .click();
  await page.getByLabel("Поиск по тексту и тегам").fill("камень");
  await expect(page.locator(".material-card")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "В избранное: Архитектурный свет",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await page.getByRole("button", { name: "Избранное", exact: true }).click();
  await expect(page.locator(".material-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Избранное", exact: true }).click();
  await page.getByRole("button", { name: "Цвет", exact: true }).click();
  await page
    .getByRole("button", { name: /Фильтр цвета/ })
    .first()
    .click();
  await expect(page.locator(".material-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Все цвета", exact: true }).click();
  await page
    .getByRole("button", { name: "Заметка или ссылка", exact: true })
    .click();
  await page.getByRole("button", { name: "Ссылка", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Открытый источник");
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://example.com/reference");
  await page
    .getByRole("button", { name: "Сохранить находку", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Открыть ссылку: Открытый источник" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await page
    .getByRole("button", { name: "Заметка или ссылка", exact: true })
    .click();
  await page.getByLabel("Название", { exact: true }).fill("Мысль");
  await page.getByLabel("Текст", { exact: true }).fill("Тепло и простые формы");
  await page
    .getByRole("button", { name: "Сохранить находку", exact: true })
    .click();
  await expect(page.locator(".material-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Design kit", exact: true }).click();
  await page.getByLabel("HEX: Акцент", { exact: true }).fill("#123456");
  await page.getByLabel("HEX: Акцент", { exact: true }).press("Enter");
  await page.getByRole("button", { name: /Современная/ }).click();
  await saved(page);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспорт design kit", exact: true })
    .click();
  const file = await downloadEvent;
  await file.saveAs("docs/qa/exports/design-kit.zip");
  const zip = await JSZip.loadAsync(
    await fs.readFile("docs/qa/exports/design-kit.zip"),
  );
  const tokens = JSON.parse(await zip.file("tokens.json")!.async("string"));
  expect(tokens.colors.accent).toBe("#123456");
  expect(tokens.typography.heading).toBe("Manrope");
  const css = await zip.file("theme.css")!.async("string");
  expect(
    await page.evaluate((css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      return sheet.cssRules.length;
    }, css),
  ).toBe(1);
  expect(await zip.file("DESIGN.md")!.async("string")).toContain("#123456");
  await page.reload();
  await expect(page.getByLabel("HEX: Акцент", { exact: true })).toHaveValue(
    "#123456",
  );
  await page.getByLabel("HEX: Текст", { exact: true }).fill("#F6F3ED");
  await page.getByLabel("HEX: Текст", { exact: true }).press("Enter");
  await expect(page.locator(".contrast-warning")).not.toHaveCount(0);
});
test("quota failure retains current changes, archive recovery and single-writer tabs", async ({
  page,
  context,
}) => {
  await newProject(page);
  await openBoard(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.locator(".notice")).toContainText("другой вкладке");
  await expect(
    second.getByRole("button", { name: "Заметка", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "projects")
        throw new DOMException("Injected quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await expect(page.locator(".error-banner")).toContainText(
    "Изменения не сохранены",
  );
  await expect(page.locator(".save-status")).toContainText("Не сохранено");
  expect((await doc(page)).objects).toHaveLength(0);
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать резервную копию", exact: true })
    .click();
  const file = await event;
  await file.saveAs("docs/qa/exports/unsaved-recovery.forme");
  const zip = await JSZip.loadAsync(
    await fs.readFile("docs/qa/exports/unsaved-recovery.forme"),
  );
  expect(
    JSON.parse(await zip.file("manifest.json")!.async("string")).objects,
  ).toHaveLength(1);
  await page.screenshot({ path: "docs/qa/write-error.png" });
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await page
    .getByRole("button", { name: "Повторить", exact: true })
    .last()
    .click();
  await saved(page);
  expect((await doc(page)).objects).toHaveLength(1);
  await page.close();
  await second.reload();
  await expect(
    second.getByRole("button", { name: "Заметка", exact: true }),
  ).toBeEnabled();
  await second.getByRole("button", { name: "Заметка", exact: true }).click();
  await saved(second);
  expect((await doc(second)).objects).toHaveLength(2);
});
test("raster types, invalid files and hostile archives rejected without partial writes", async ({
  page,
}) => {
  await newProject(page);
  const make = async (type: string) =>
    Buffer.from(
      await page.evaluate((type) => {
        const c = document.createElement("canvas");
        c.width = 120;
        c.height = 80;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#b8472d";
        ctx.fillRect(0, 0, 60, 80);
        ctx.fillStyle = "#123456";
        ctx.fillRect(60, 0, 60, 80);
        return c.toDataURL(type).split(",")[1];
      }, type),
      "base64",
    );
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles([
      {
        name: "sample.png",
        mimeType: "image/png",
        buffer: await make("image/png"),
      },
      {
        name: "sample.webp",
        mimeType: "image/webp",
        buffer: await make("image/webp"),
      },
    ]);
  await expect(page.locator(".material-card")).toHaveCount(2);
  await saved(page);
  const bad = [
    {
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg onload="alert(1)"></svg>'),
    },
    {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not image"),
    },
    {
      name: "large.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    },
    {
      name: "wrong-mime.jpg",
      mimeType: "image/jpeg",
      buffer: await make("image/png"),
    },
  ];
  const enormous = await make("image/png");
  enormous.writeUInt32BE(10000, 16);
  enormous.writeUInt32BE(10000, 20);
  bad.push({ name: "pixels.png", mimeType: "image/png", buffer: enormous });
  for (const file of bad) {
    await page
      .getByLabel("Загрузить изображения", { exact: true })
      .setInputFiles(file);
    await expect(page.locator(".global-error")).toBeVisible();
    await expect(page.locator(".material-card")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Закрыть сообщение об ошибке" })
      .click();
  }
  const initial = await doc(page);
  const cases: JSZip[] = [];
  let zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ ...initial, schemaVersion: 999 }));
  cases.push(zip);
  zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(initial));
  cases.push(zip);
  zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(initial));
  zip.file("../evil.html", "<script>alert(1)</script>");
  cases.push(zip);
  for (const z of cases) {
    await page
      .getByLabel("Импорт архива FORME", { exact: true })
      .setInputFiles({
        name: "bad.forme",
        mimeType: "application/zip",
        buffer: await z.generateAsync({
          type: "nodebuffer",
          compression: "STORE",
        }),
      });
    await expect(page.locator(".global-error")).toBeVisible();
    expect((await doc(page)).id).toBe(initial.id);
    expect((await doc(page)).materials).toHaveLength(2);
    await page
      .getByRole("button", { name: "Закрыть сообщение об ошибке" })
      .click();
  }
  zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(initial));
  zip.file("images/bomb", Buffer.alloc(3 * 1024 * 1024));
  await page
    .getByLabel("Импорт архива FORME", { exact: true })
    .setInputFiles({
      name: "compressed.forme",
      mimeType: "application/zip",
      buffer: await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      }),
    });
  await expect(page.locator(".global-error")).toContainText("без сжатия");
  expect((await doc(page)).materials).toHaveLength(2);
});
test("mobile upload, properties, keyboard focus and actual export", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(
    page,
    "Очень длинное название коллекции для проверки переноса и устойчивости интерфейса",
  );
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles(path.join(root, "public/images/photo-1.jpg"));
  await expect(page.locator(".material-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "На доску: photo-1", exact: true })
    .click();
  await page.getByRole("button", { name: "Доска", exact: true }).click();
  await page
    .getByRole("button", { name: "Закрыть материалы", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Объект: photo-1", exact: true })
    .click();
  await expect(
    page.getByLabel("Название объекта", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("X", { exact: true }).fill("160");
  await page.getByLabel("X", { exact: true }).press("Enter");
  await expect.poll(async () => (await doc(page)).objects[0].x).toBe(160);
  await page
    .getByRole("button", { name: "Закрыть свойства", exact: true })
    .click();
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest("dialog") !== null,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Экспорт", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const fileEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /Мудборд в PNG/ }).click();
  const file = await fileEvent;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
