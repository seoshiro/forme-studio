import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const out = process.argv[2] || "docs/qa/screenshots";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5180");
await page
  .getByRole("button", {
    name: "Открыть пример «Тихая архитектура»",
    exact: true,
  })
  .click();
await page.locator(".board-scene img").first().waitFor();
const base = page.url().replace(/board$/, "");
const audit = [];
for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1366, 768],
  [1920, 1080],
]) {
  await page.setViewportSize({ width, height });
  for (const view of ["home", "library", "board", "kit"]) {
    await page.goto(view === "home" ? "http://127.0.0.1:5180" : base + view);
    await page.evaluate(() => document.fonts.ready);
    await page
      .locator(
        view === "home"
          ? ".hero"
          : view === "library"
            ? ".material-grid"
            : view === "board"
              ? ".board-scene"
              : ".kit-live-preview",
      )
      .waitFor({ state: "attached" });
    await page.waitForTimeout(300);
    if (view === "board" && width < 801) {
      const close = page.getByRole("button", { name: "Закрыть материалы" });
      if (await close.isVisible()) await close.click();
    }
    await page.screenshot({
      path: `${out}/${view}-${width}.png`,
      fullPage: view !== "board",
    });
    audit.push({
      view,
      width,
      height,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      images: await page
        .locator("img")
        .evaluateAll((imgs) =>
          imgs.map((i) => ({
            src: i.getAttribute("src"),
            loaded: i.complete && i.naturalWidth > 0,
          })),
        ),
    });
    if (view === "kit" && width === 390) {
      await page
        .getByRole("button", { name: "Превью и контраст", exact: true })
        .click();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${out}/kit-preview-${width}.png`,
        fullPage: true,
      });
    }
  }
}
await fs.writeFile(
  `${out}/capture.json`,
  JSON.stringify({ browser: browser.version(), errors, audit }, null, 2),
);
await browser.close();
console.log(
  JSON.stringify({ out, errors, overflow: audit.filter((x) => x.overflow) }),
);
