import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import { gzipSync } from "node:zlib";
const dir = "docs/remediation/performance",
  base = "http://127.0.0.1:5180";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = {
  timestamp: new Date().toISOString(),
  browser: browser.version(),
  cpu: os.cpus()[0].model,
  platform: os.platform(),
  viewport: { width: 1366, height: 768 },
};
const save = () =>
  fs.writeFile(
    `${dir}/performance-results.json`,
    JSON.stringify(result, null, 2),
  );
async function traceEnd(cdp, name) {
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  const { stream } = await done;
  let text = "";
  for (;;) {
    const r = await cdp.send("IO.read", { handle: stream });
    text += r.base64Encoded ? Buffer.from(r.data, "base64").toString() : r.data;
    if (r.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  await fs.writeFile(`${dir}/${name}.json.gz`, gzipSync(text));
  return { bytes: text.length, gzipBytes: gzipSync(text).length };
}
async function read(page) {
  return page.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => r(q.result);
    });
    const d = await new Promise((r) => {
      const q = db
        .transaction("projects")
        .objectStore("projects")
        .get(location.hash.split("/")[2]);
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return d;
  });
}
const cold = await browser.newContext({ viewport: result.viewport });
const p = await cold.newPage();
const c = await cold.newCDPSession(p);
try {
  await c.send("Network.enable");
  await c.send("Network.setCacheDisabled", { cacheDisabled: true });
  await c.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 200000,
    uploadThroughput: 75000,
  });
  await p.addInitScript(() => {
    window.auditLcp = [];
    new PerformanceObserver((l) =>
      window.auditLcp.push(
        ...l
          .getEntries()
          .map((e) => ({
            startTime: e.startTime,
            size: e.size,
            element: e.element?.className,
            url: e.url,
          })),
      ),
    ).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await c.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing,loading",
    transferMode: "ReturnAsStream",
  });
  const t = performance.now();
  await p.goto(base, { waitUntil: "load", timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.locator(".hero").waitFor();
  await p.waitForTimeout(300);
  result.cold = {
    network: {
      latencyMs: 150,
      downloadBytesPerSecond: 200000,
      uploadBytesPerSecond: 75000,
      cache: false,
      cpuThrottle: "none",
    },
    wallMs: performance.now() - t,
    ...(await p.evaluate(() => ({
      lcp: window.auditLcp,
      paint: performance
        .getEntriesByType("paint")
        .map((e) => ({ name: e.name, startTime: e.startTime })),
      resources: performance
        .getEntriesByType("resource")
        .map((e) => ({
          name: e.name.split("/").at(-1),
          bytes: e.transferSize,
          decoded: e.decodedBodySize,
          duration: e.duration,
        })),
    }))),
  };
  result.cold.trace = await traceEnd(c, "cold-load-trace");
} catch (e) {
  result.coldError = e.stack;
} finally {
  await cold.close();
  await save();
}
const context = await browser.newContext({ viewport: result.viewport });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
try {
  await page.addInitScript(() => {
    window.auditUrlStats = { made: 0, revoked: 0, active: new Map() };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      const u = create(b);
      window.auditUrlStats.made++;
      window.auditUrlStats.active.set(u, b.size);
      return u;
    };
    URL.revokeObjectURL = (u) => {
      window.auditUrlStats.revoked++;
      window.auditUrlStats.active.delete(u);
      return revoke(u);
    };
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая коллекция", exact: true })
    .click();
  await page
    .getByLabel("Название коллекции", { exact: true })
    .fill("500 объектов / 60 материалов");
  await page
    .getByRole("button", { name: "Создать коллекцию", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Добавить изображения", exact: true }),
  ).toBeEnabled();
  const uploads = [];
  for (let i = 0; i < 60; i++)
    uploads.push({
      name: `Stress-${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: await fs.readFile(`public/images/photo-${(i % 12) + 1}.jpg`),
    });
  const uploadStart = performance.now();
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles(uploads);
  await expect(page.locator(".material-card")).toHaveCount(60, {
    timeout: 60000,
  });
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  result.upload = {
    materials: 60,
    distinctSourcePhotos: 12,
    originalBytes: uploads.reduce((n, x) => n + x.buffer.length, 0),
    wallMs: performance.now() - uploadStart,
    urls: await page.evaluate(() => ({
      made: window.auditUrlStats.made,
      revoked: window.auditUrlStats.revoked,
      active: window.auditUrlStats.active.size,
      activeBytes: [...window.auditUrlStats.active.values()].reduce(
        (a, b) => a + b,
        0,
      ),
    })),
  };
  await page.getByRole("button", { name: "Доска", exact: true }).click();
  result.seed = await page.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => r(q.result);
    });
    return new Promise((r) => {
      const tx = db.transaction(["projects", "images"], "readwrite"),
        store = tx.objectStore("projects");
      const q = store.get(location.hash.split("/")[2]);
      let summary;
      q.onsuccess = () => {
        const d = q.result;
        d.objects = Array.from({ length: 500 }, (_, i) => ({
          id: `stress-${i}`,
          type: "image",
          title: `Объект ${i + 1}`,
          assetId: d.materials[i % 60].id,
          x: (i % 25) * 55 + 4,
          y: Math.floor(i / 25) * 48 + 4,
          width: 50,
          height: 42,
        }));
        d.revision++;
        summary = {
          objects: d.objects.length,
          materials: d.materials.length,
          revision: d.revision,
        };
        store.put(d);
      };
      tx.oncomplete = () => {
        db.close();
        r(summary);
      };
    });
  });
  await page.reload();
  await expect(page.locator(".board-scene .scene-object")).toHaveCount(500);
  await expect
    .poll(() =>
      page
        .locator(".board-scene img")
        .evaluateAll((a) => a.every((i) => i.naturalWidth > 0)),
    )
    .toBe(true);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  result.heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  result.gestures = [];
  for (const kind of ["drag", "resize"]) {
    const target = page.getByRole("button", {
      name: kind === "resize" ? "Объект: Объект 500" : "Объект: Объект 1",
      exact: true,
    });
    await target.click();
    const handle = kind === "resize" ? page.locator(".resize-handle") : target;
    const b = await handle.boundingBox();
    const before = (await read(page)).revision;
    await page.evaluate(() => {
      window.auditFrames = [];
      window.auditStop = false;
      let last = performance.now();
      function tick(t) {
        window.auditFrames.push(t - last);
        last = t;
        if (!window.auditStop) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    await cdp.send("Tracing.start", {
      categories: "devtools.timeline,blink.user_timing,v8.execute",
      transferMode: "ReturnAsStream",
    });
    const start = performance.now();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      b.x + b.width / 2 + (kind === "resize" ? -10 : 70),
      b.y + b.height / 2 + (kind === "resize" ? -8 : 40),
      { steps: 45 },
    );
    await page.mouse.up();
    await expect.poll(async () => (await read(page)).revision).toBe(before + 1);
    const frames = await page.evaluate(() => {
      window.auditStop = true;
      return window.auditFrames.slice(2).sort((a, b) => a - b);
    });
    const wallMs = performance.now() - start;
    const trace = await traceEnd(cdp, `500-object-${kind}-trace`);
    result.gestures.push({
      kind,
      wallMs,
      revisionDelta: (await read(page)).revision - before,
      count: frames.length,
      p50: frames[Math.floor(frames.length * 0.5)],
      p95: frames[Math.floor(frames.length * 0.95)],
      max: frames.at(-1),
      framesOver50ms: frames.filter((x) => x > 50).length,
      trace,
    });
  }
  const persistedBeforeReload = await read(page);
  const reloadStart = performance.now();
  await page.reload();
  await expect(page.locator(".board-scene .scene-object")).toHaveCount(500);
  await expect
    .poll(() =>
      page
        .locator(".board-scene img")
        .evaluateAll((a) => a.every((i) => i.naturalWidth > 0)),
    )
    .toBe(true);
  expect((await read(page)).objects).toEqual(persistedBeforeReload.objects);
  result.reload = {
    wallMs: performance.now() - reloadStart,
    objects: 500,
    geometryEqual: true,
  };
  const exportStart = performance.now();
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  const download = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: /Мудборд в PNG/ }).click();
  await (await download).saveAs(`${dir}/stress-500-export.png`);
  result.export = {
    wallMs: performance.now() - exportStart,
    bytes: (await fs.stat(`${dir}/stress-500-export.png`)).size,
  };
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${dir}/stress-500.png` });
  await page
    .getByRole("button", { name: "FORME — на главную", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.auditUrlStats.active.size), {
      timeout: 15000,
    })
    .toBe(0);
  await cdp.send("HeapProfiler.collectGarbage");
  result.heapAfterClose = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  result.urlsAfterClose = await page.evaluate(() => ({
    made: window.auditUrlStats.made,
    revoked: window.auditUrlStats.revoked,
    active: window.auditUrlStats.active.size,
  }));
} catch (e) {
  result.stressError = e.stack;
} finally {
  await context.close();
  await browser.close();
  await save();
  console.log(JSON.stringify(result, null, 2));
}
