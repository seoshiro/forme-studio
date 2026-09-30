import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("axe on real pages at four widths, keyboard skip, reduced motion", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await page.locator(".board-scene img").first().waitFor();
  const base = page.url().replace(/board$/, "");
  const results = [];
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1366, 768],
    [1920, 1080],
  ])
    for (const view of ["home", "library", "board", "kit"]) {
      await page.setViewportSize({ width, height });
      await page.goto(view === "home" ? "http://127.0.0.1:5180" : base + view);
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
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: {
              run: (
                options: unknown,
              ) => Promise<{
                violations: {
                  id: string;
                  impact: string;
                  nodes: { target: string[]; failureSummary: string }[];
                }[];
              }>;
            };
          }
        ).axe;
        return (
          await axe.run({
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
            },
          })
        ).violations;
      });
      results.push({ view, width, violations });
      expect.soft(violations, `${view} ${width}`).toEqual([]);
      expect
        .soft(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${view} overflow ${width}`,
        )
        .toBe(true);
    }
  await fs.writeFile(
    "docs/qa/accessibility.json",
    JSON.stringify(results, null, 2),
  );
  await page.goto(base + "board");
  const before = page.url();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "К содержимому" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(page.url()).toBe(before);
  await expect(page.locator("#main-content")).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".button")
      .first()
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe("0s");
});
