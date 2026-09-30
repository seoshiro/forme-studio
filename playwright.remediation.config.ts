import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("docs/remediation", { recursive: true });
export default defineConfig({
  testDir: "./tests",
  testMatch: "remediation.spec.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "docs/remediation/results.json" }],
  ],
  outputDir: "test-results/remediation",
  use: {
    baseURL: process.env.FORME_BASE_URL ?? "http://127.0.0.1:5180",
    channel: "chrome",
    viewport: { width: 1366, height: 768 },
    trace: "retain-on-failure",
  },
});
