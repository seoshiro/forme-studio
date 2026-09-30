import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
for (const dir of ["docs/qa/exports", "docs/remediation"])
  mkdirSync(dir, { recursive: true });
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "docs/qa/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:5180",
    browserName: "chromium",
    channel: "chrome",
    viewport: { width: 1366, height: 768 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results",
});
