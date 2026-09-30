import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import JSZip from "jszip";

const base = new URL(process.argv[2]).origin;
const out = "docs/publication/production";
await fs.mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({ channel: "chrome" });
const result = {
  base,
  date: new Date().toISOString(),
  browser: browser.version(),
  screens: [],
  errors: [],
  failed: [],
  external: [],
};
const observe = (page) => {
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") result.errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400)
      result.failed.push({ url: r.url(), status: r.status() });
  });
  page.on("requestfailed", (r) => {
    if (!r.failure()?.errorText.includes("ERR_ABORTED"))
      result.failed.push({ url: r.url(), error: r.failure()?.errorText });
  });
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== base)
      result.external.push(r.url());
  });
};
const doc = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    return new Promise((resolve, reject) => {
      const q = db
        .transaction("projects")
        .objectStore("projects")
        .get(location.hash.split("/")[2]);
      q.onsuccess = () => {
        db.close();
        resolve(q.result);
      };
      q.onerror = () => reject(q.error);
    });
  });
const saved = (page) =>
  expect(page.locator(".save-status")).toContainText("Сохранено");
const download = async (page, name, filename) => {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  const file = await pending;
  assert.equal(await file.failure(), null);
  await file.saveAs(`${out}/${filename}`);
  return fs.readFile(`${out}/${filename}`);
};
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  observe(page);
  const response = await page.goto(base);
  assert.equal(response.status(), 200);
  result.headers = response.headers();
  const html = await response.text();
  assert(!/C:[\\/]Users|localhost|127\.0\.0\.1/.test(html));
  assert.match(await page.title(), /FORME/);
  result.metadata = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]').content,
    ogTitle: document.querySelector('meta[property="og:title"]').content,
    ogImage: document.querySelector('meta[property="og:image"]').content,
    ogUrl: document.querySelector('meta[property="og:url"]')?.content,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
  }));
  for (const asset of [
    "/favicon.svg",
    "/og.png",
    "/fonts/Manrope.ttf",
    "/fonts/CormorantGaramond.ttf",
    "/fonts/CormorantGaramond-Italic.ttf",
    "/JSZIP_THIRD_PARTY_NOTICES.txt",
    "/THIRD_PARTY_NOTICES.md",
    ...Array.from({ length: 12 }, (_, i) => `/images/photo-${i + 1}.jpg`),
  ]) {
    const fetched = await page.request.get(base + asset);
    assert.equal(fetched.status(), 200, asset);
    assert((await fetched.body()).length > 100, asset);
  }
  await page
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая коллекция", exact: true })
    .click();
  await page
    .getByLabel("Название коллекции", { exact: true })
    .fill("Production verification");
  await page
    .getByRole("button", { name: "Создать коллекцию", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Добавить изображения", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles("public/images/photo-1.jpg");
  await expect(page.locator(".material-card")).toHaveCount(1);
  await saved(page);
  await page
    .getByRole("button", { name: "На доску: photo-1", exact: true })
    .click();
  await page.getByRole("button", { name: "Доска", exact: true }).click();
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
  await saved(page);
  const before = await doc(page);
  assert.equal(before.objects.length, 2);
  assert.equal(before.objects[0].x, 240);
  await page.reload();
  await saved(page);
  assert.deepEqual((await doc(page)).objects, before.objects);
  await expect(page.locator(".board-scene img")).toBeVisible();
  assert(
    (await page.locator(".board-scene img").getAttribute("src")).startsWith(
      "blob:",
    ),
  );
  await page.getByRole("button", { name: "Design kit", exact: true }).click();
  await page.getByLabel("HEX: Акцент", { exact: true }).fill("#805040");
  await page.getByLabel("HEX: Акцент", { exact: true }).press("Tab");
  await saved(page);
  const kitDoc = await doc(page);
  await page.reload();
  await saved(page);
  assert.deepEqual((await doc(page)).kit, kitDoc.kit);
  const kit = await JSZip.loadAsync(
    await download(page, "Экспорт design kit", "design-kit.zip"),
  );
  assert(
    kit.file("tokens.json") && kit.file("theme.css") && kit.file("DESIGN.md"),
  );
  assert.match(await kit.file("theme.css").async("string"), /#805040/i);
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  const png = await download(page, /Мудборд в PNG/, "board.png");
  assert.equal(png.readUInt32BE(16), 1400);
  assert.equal(png.readUInt32BE(20), 1000);
  const pixels = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${b64}`)).blob(),
    );
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    img.close();
    const note = ctx.getImageData(104, 104, 290, 150).data;
    let ink = 0;
    for (let i = 0; i < note.length; i += 4)
      if (note[i] < 70 && note[i + 1] < 70 && note[i + 2] < 70) ink++;
    const photo = ctx.getImageData(460, 100, 120, 180).data;
    const colors = new Set();
    for (let i = 0; i < photo.length; i += 4)
      colors.add(`${photo[i]},${photo[i + 1]},${photo[i + 2]}`);
    return { ink, photoColors: colors.size };
  }, png.toString("base64"));
  assert(pixels.ink > 100 && pixels.photoColors > 100);
  const archive = await download(page, /Полный архив .forme/, "project.forme");
  const zip = await JSZip.loadAsync(archive);
  const expectedHash = hash(await fs.readFile("public/images/photo-1.jpg"));
  assert.equal(
    hash(
      await zip
        .file(`images/${kitDoc.materials[0].blobId}`)
        .async("nodebuffer"),
    ),
    expectedHash,
  );
  const fresh = await browser.newContext();
  const restored = await fresh.newPage();
  observe(restored);
  await restored.goto(base);
  await restored
    .getByLabel("Импорт архива FORME", { exact: true })
    .setInputFiles(path.resolve(`${out}/project.forme`));
  await expect(restored.locator(".board-scene img")).toBeVisible();
  await saved(restored);
  const after = await doc(restored);
  assert.notEqual(after.id, kitDoc.id);
  assert.notEqual(after.materials[0].blobId, kitDoc.materials[0].blobId);
  assert.deepEqual(after.objects, kitDoc.objects);
  assert.deepEqual(after.kit, kitDoc.kit);
  const restoredHash = await restored.evaluate(async (id) => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => r(q.result);
    });
    const image = await new Promise((r) => {
      const q = db.transaction("images").objectStore("images").get(id);
      q.onsuccess = () => r(q.result);
    });
    db.close();
    const sum = await crypto.subtle.digest(
      "SHA-256",
      await image.blob.arrayBuffer(),
    );
    return [...new Uint8Array(sum)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }, after.materials[0].blobId);
  assert.equal(restoredHash, expectedHash);
  await restored.reload();
  await saved(restored);
  assert.deepEqual((await doc(restored)).objects, kitDoc.objects);
  result.workflow = {
    status: "PASS",
    reload: true,
    cleanImport: true,
    png: { width: 1400, height: 1000, bytes: png.length, ...pixels },
    archiveBytes: archive.length,
    expectedHash,
    restoredHash,
    kit: "edited accent verified in CSS and restored document",
  };
  await fresh.close();
  await context.close();

  // Stable demo data: separate from the verification document and user profiles.
  const visual = await browser.newContext();
  const screen = await visual.newPage();
  observe(screen);
  await screen.goto(base);
  await screen
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await screen.locator(".board-scene img").first().waitFor();
  await saved(screen);
  const projectUrl = screen.url().replace(/board$/, "");
  for (const [width, height] of [
    [390, 844],
    [1366, 768],
  ]) {
    await screen.setViewportSize({ width, height });
    for (const view of ["home", "library", "board", "kit"]) {
      await screen.goto(view === "home" ? base : projectUrl + view);
      await screen
        .locator(
          {
            home: ".hero",
            library: ".material-grid",
            board: ".board-scene",
            kit: ".kit-live-preview",
          }[view],
        )
        .waitFor({ state: "attached" });
      await screen.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          screen
            .locator("img")
            .evaluateAll((images) =>
              images.every(
                (img) =>
                  Boolean(img.currentSrc) &&
                  img.complete &&
                  img.naturalWidth > 0,
              ),
            ),
        )
        .toBe(true);
      await screen.addScriptTag({
        path: require.resolve("axe-core/axe.min.js"),
      });
      const axe = await screen.evaluate(() =>
        window.axe.run({
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        }),
      );
      assert.deepEqual(axe.violations, [], `${view} ${width}`);
      assert(
        await screen.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const fonts = await screen.evaluate(() => ({
        manrope: document.fonts.check('16px "Manrope"'),
        cormorant: document.fonts.check('16px "Cormorant Garamond"'),
      }));
      assert(fonts.manrope && fonts.cormorant);
      const filename = `${view}-${width}.png`;
      await screen.screenshot({ path: `${out}/${filename}`, fullPage: true });
      result.screens.push({
        view,
        width,
        height,
        screenshot: filename,
        fonts,
        violations: axe.violations,
        incomplete: axe.incomplete.map((x) => x.id),
      });
    }
  }
  await screen.goto(projectUrl + "board");
  await screen.keyboard.press("Tab");
  await expect(
    screen.getByRole("link", { name: "К содержимому" }),
  ).toBeFocused();
  await screen.keyboard.press("Enter");
  await expect(screen.locator("#main-content")).toBeFocused();
  result.keyboardSkip = "PASS";
  await visual.close();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.external, []);
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  result.error = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await fs.writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        status: result.status,
        base,
        screens: result.screens.length,
        error: result.error,
        errors: result.errors,
        failed: result.failed,
      },
      null,
      2,
    ),
  );
}
