import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
test("100 thumbnail objects: one drag commits one revision, measured frames", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await page.locator(".board-scene img").first().waitFor();
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => r(q.result);
    });
    const id = location.hash.split("/")[2];
    return await new Promise<{ revision: number; bytes: number }>((r) => {
      const tx = db.transaction(["projects", "images"], "readwrite"),
        s = tx.objectStore("projects");
      const result = { revision: 0, bytes: 0 };
      const req = s.get(id);
      req.onsuccess = () => {
        const d = req.result;
        const base = d.objects[0];
        const materials = d.materials.filter(
          (m: { type: string }) => m.type === "image",
        );
        d.objects = Array.from({ length: 100 }, (_, i) => ({
          ...base,
          assetId: materials[i % materials.length].id,
          id: `stress-${i}`,
          title: `Объект ${i + 1}`,
          x: (i % 10) * 138 + 4,
          y: Math.floor(i / 10) * 98 + 4,
          width: 130,
          height: 90,
        }));
        d.revision++;
        result.revision = d.revision;
        s.put(d);
      };
      const images = tx.objectStore("images").getAll();
      images.onsuccess = () => {
        result.bytes = images.result.reduce(
          (n: number, x: { thumbnail: Blob }) => n + x.thumbnail.size,
          0,
        );
      };
      tx.oncomplete = () => {
        db.close();
        r(result);
      };
    });
  });
  await page.reload();
  await expect(page.locator(".board-scene .scene-object")).toHaveCount(100);
  expect(
    await page
      .locator(".board-scene img")
      .evaluateAll(
        (images) =>
          new Set(images.map((i) => (i as HTMLImageElement).src)).size,
      ),
  ).toBe(4);
  await page.evaluate(() => {
    const w = window as unknown as {
      formeFrameTimes: number[];
      stopFrames: boolean;
    };
    w.formeFrameTimes = [];
    w.stopFrames = false;
    let last = performance.now();
    const tick = (now: number) => {
      w.formeFrameTimes.push(now - last);
      last = now;
      if (!w.stopFrames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const target = page.getByRole("button", {
    name: "Объект: Объект 1",
    exact: true,
  });
  const b = (await target.boundingBox())!;
  const start = Date.now();
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 55, b.y + 35, { steps: 45 });
  await page.mouse.up();
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  const measured = await page.evaluate(async () => {
    const w = window as unknown as {
      formeFrameTimes: number[];
      stopFrames: boolean;
    };
    w.stopFrames = true;
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => r(q.result);
    });
    const d = await new Promise<{ revision: number }>((r) => {
      const q = db
        .transaction("projects")
        .objectStore("projects")
        .get(location.hash.split("/")[2]);
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return { frames: w.formeFrameTimes, revision: d.revision };
  });
  expect(measured.revision - before.revision).toBe(1);
  const sorted = measured.frames.slice(2).sort((a, b) => a - b);
  await fs.writeFile(
    "docs/qa/performance.json",
    JSON.stringify(
      {
        browser: browser.version(),
        platform: os.platform(),
        cpu: os.cpus()[0].model,
        objects: 100,
        thumbnailBytes: before.bytes,
        viewport: { width: 1366, height: 768 },
        wallMs: Date.now() - start,
        frameCount: sorted.length,
        p50Ms: sorted[Math.floor(sorted.length * 0.5)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        maxMs: sorted.at(-1),
        revisionDelta: measured.revision - before.revision,
        scope: "Headless Chrome via Playwright, not a universal FPS claim",
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "docs/qa/stress-100.png" });
});
