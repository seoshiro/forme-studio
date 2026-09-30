import { chromium } from "@playwright/test";
import JSZip from "jszip";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
const zip = await JSZip.loadAsync(
  await fs.readFile("docs/qa/exports/golden.forme"),
);
const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
const image = await zip
  .file(`images/${manifest.materials[0].blobId}`)
  .async("nodebuffer");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const originalHash = hash(await fs.readFile("public/images/photo-1.jpg"));
if (hash(image) !== originalHash)
  throw new Error("Archive image bytes differ from original");
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5180");
await page.getByRole("button", { name: "Открыть студию", exact: true }).click();
await page
  .getByLabel("Импорт архива FORME", { exact: true })
  .setInputFiles(path.resolve("docs/qa/exports/golden.forme"));
await page.locator(".board-scene img").waitFor();
const restoredHash = await page.evaluate(async () => {
  const db = await new Promise((r) => {
    const q = indexedDB.open("forme-studio");
    q.onsuccess = () => r(q.result);
  });
  const docs = await new Promise((r) => {
    const q = db.transaction("projects").objectStore("projects").getAll();
    q.onsuccess = () => r(q.result);
  });
  const stored = await new Promise((r) => {
    const q = db
      .transaction("images")
      .objectStore("images")
      .get(docs[0].materials[0].blobId);
    q.onsuccess = () => r(q.result);
  });
  db.close();
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await stored.blob.arrayBuffer()),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
});
if (restoredHash !== originalHash)
  throw new Error("Restored original bytes differ");
const png = await fs.readFile("docs/qa/exports/golden.png");
const pixels = await page.evaluate(async (b64) => {
  const image = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${b64}`)).blob(),
  );
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const note = ctx.getImageData(104, 104, 290, 150).data;
  let ink = 0;
  for (let i = 0; i < note.length; i += 4)
    if (note[i] < 70 && note[i + 1] < 70 && note[i + 2] < 70) ink++;
  const photo = ctx.getImageData(460, 100, 120, 180).data;
  const colors = new Set();
  for (let i = 0; i < photo.length; i += 4)
    colors.add(`${photo[i]},${photo[i + 1]},${photo[i + 2]}`);
  return {
    width: image.width,
    height: image.height,
    noteInkPixels: ink,
    photoUniqueColors: colors.size,
  };
}, png.toString("base64"));
if (pixels.noteInkPixels < 100 || pixels.photoUniqueColors < 100)
  throw new Error("PNG missing note or photo content");
await fs.writeFile(
  "docs/qa/artifact-integrity.json",
  JSON.stringify(
    {
      originalHash,
      archiveHash: hash(image),
      restoredHash,
      png: pixels,
      isolatedContext: true,
      status: "PASS",
    },
    null,
    2,
  ),
);
await browser.close();
console.log(
  "PASS: original, archive, and clean restored Blob SHA-256 match; PNG decoded with photo and note pixels.",
);
