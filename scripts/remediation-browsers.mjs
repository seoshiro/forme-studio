import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(".playwright-browsers");
const { chromium, firefox, webkit, expect } = await import("@playwright/test");
const { default: JSZip } = await import("jszip");
const base = process.env.FORME_BASE_URL || "http://127.0.0.1:5180";
const output = "docs/remediation/browsers";
await fs.mkdir(output, { recursive: true });
const results = [];
const hash = (b) => createHash("sha256").update(b).digest("hex");
const doc = (p) =>
  p.evaluate(async () => {
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
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  let browser,
    phase = "launch";
  try {
    browser = await engine.launch();
    phase = "flow";
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .getByRole("button", { name: "Открыть студию", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Новая коллекция", exact: true })
      .click();
    await page
      .getByLabel("Название коллекции", { exact: true })
      .fill(`Smoke ${name}`);
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
    await expect(page.locator(".save-status")).toContainText("Сохранено");
    await page
      .getByRole("button", { name: "На доску: photo-1", exact: true })
      .click();
    await page.getByRole("button", { name: "Доска", exact: true }).click();
    await page
      .getByRole("button", { name: "Объект: photo-1", exact: true })
      .click();
    await page.getByLabel("X", { exact: true }).fill("320");
    await expect.poll(async () => (await doc(page)).objects[0].x).toBe(320);
    await page.reload();
    await expect(page.locator(".board-scene img")).toBeVisible();
    assert.equal((await doc(page)).objects[0].x, 320);
    await page.getByRole("button", { name: "Экспорт", exact: true }).click();
    let wait = page.waitForEvent("download");
    await page.getByRole("button", { name: /Мудборд в PNG/ }).click();
    const pngPath = `${output}/${name}.png`;
    await (await wait).saveAs(pngPath);
    const png = await fs.readFile(pngPath);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(png.readUInt32BE(16), 1400);
    assert.equal(png.readUInt32BE(20), 1000);
    wait = page.waitForEvent("download");
    await page.getByRole("button", { name: /Полный архив .forme/ }).click();
    const archive = `${output}/${name}.forme`;
    await (await wait).saveAs(archive);
    const zip = await JSZip.loadAsync(await fs.readFile(archive));
    const original = await doc(page);
    const jpegHash = hash(
      await zip
        .file(`images/${original.materials[0].blobId}`)
        .async("nodebuffer"),
    );
    assert.equal(
      jpegHash,
      hash(await fs.readFile("public/images/photo-1.jpg")),
    );
    const fresh = await browser.newContext();
    const restored = await fresh.newPage();
    await restored.goto(base);
    await restored
      .getByLabel("Импорт архива FORME", { exact: true })
      .setInputFiles(path.resolve(archive));
    await expect(restored.locator(".board-scene img")).toBeVisible();
    await expect
      .poll(() =>
        restored.locator(".board-scene img").evaluate((i) => i.naturalWidth),
      )
      .toBeGreaterThan(0);
    const after = await doc(restored);
    assert.deepEqual(after.objects, original.objects);
    assert.notEqual(after.id, original.id);
    assert.notEqual(after.materials[0].blobId, original.materials[0].blobId);
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
    assert.equal(restoredHash, jpegHash);
    await restored.reload();
    await expect(restored.locator(".board-scene img")).toBeVisible();
    assert.deepEqual(errors, []);
    results.push({
      name,
      status: "PASS",
      version: browser.version(),
      x: 320,
      png: { width: 1400, height: 1000, bytes: png.length },
      originalHash: jpegHash,
      restoredHash,
      freshContext: true,
      errors,
    });
    await fresh.close();
    await context.close();
  } catch (error) {
    results.push({
      name,
      status: phase === "launch" ? "BLOCKED" : "FAIL",
      phase,
      error: String(error),
    });
  } finally {
    await browser?.close();
  }
}
await fs.writeFile(
  `${output}/results.json`,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      base,
      browserPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
      results,
    },
    null,
    2,
  ),
);
console.log(results.map((r) => `${r.name}: ${r.status}`).join("\n"));
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
