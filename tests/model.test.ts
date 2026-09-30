import test from "node:test";
import assert from "node:assert/strict";
import {
  blankProject,
  validateDocument,
  History,
  contrast,
  extractColors,
  safeUrl,
  kitFiles,
  clampObject,
} from "../src/model.ts";
import { imageDimensions } from "../src/image-header.ts";
test("document schema rejects versions, dangling images, oversized and non-finite geometry", () => {
  const p = blankProject();
  validateDocument(p);
  for (const update of [
    { schemaVersion: 2 },
    { width: Infinity },
    { width: 4001 },
    {
      objects: [
        {
          id: "1",
          type: "image",
          title: "x",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          assetId: "missing",
        },
      ],
    },
  ])
    assert.throws(() => validateDocument({ ...p, ...update }));
});
test("history reverses operations, clears redo branch, bounded to 80 metadata snapshots", () => {
  const h = new History<{ x: number }>();
  for (let x = 0; x < 90; x++) h.push({ x });
  assert.equal(h.past.length, 80);
  assert.deepEqual(h.undo({ x: 90 }), { x: 89 });
  assert.deepEqual(h.redo({ x: 89 }), { x: 90 });
  h.undo({ x: 90 });
  h.push({ x: 99 });
  assert.equal(h.future.length, 0);
});
test("WCAG reference contrast pairs", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#ffffff"), 1);
  assert.ok(Math.abs(contrast("#777777", "#ffffff") - 4.478) < 0.002);
});
test("palette is deterministic, ignores transparent pixels, composites partial alpha", () => {
  const input = new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0,
  ]);
  assert.deepEqual(extractColors(input), ["#ff0000", "#00ff00"]);
  assert.deepEqual(extractColors(input), extractColors(input));
  assert.deepEqual(extractColors(new Uint8ClampedArray([0, 0, 0, 128])), [
    "#7f7f7f",
  ]);
});
test("palette returns six real distinct colors", () => {
  const p = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 0,
    255, 255, 0, 255, 255, 255,
  ]);
  assert.equal(extractColors(p).length, 6);
});
test("safe bookmarks, safe CSS serialization, truthful kit settings", () => {
  assert.throws(() => safeUrl("javascript:alert(1)"));
  assert.throws(() => safeUrl("https://user:pass@example.com"));
  const p = blankProject("Example <script>");
  p.kit.colors.accent = "#abcdef";
  const f = kitFiles(p);
  assert.equal(JSON.parse(f["tokens.json"]).colors.accent, "#abcdef");
  assert.match(f["theme.css"], /--accent: #abcdef/);
  assert.doesNotMatch(f["DESIGN.md"], /<script>/);
});
test("clamp contains object including oversized dimensions", () => {
  const p = blankProject();
  assert.deepEqual(
    clampObject(
      {
        id: "o",
        type: "swatch",
        title: "x",
        color: "#ffffff",
        x: -50,
        y: 999,
        width: 5000,
        height: 5000,
      },
      p,
    ),
    {
      id: "o",
      type: "swatch",
      title: "x",
      color: "#ffffff",
      x: 0,
      y: 0,
      width: 1400,
      height: 1000,
    },
  );
});
test("image magic rejects SVG and corrupt input before decode", () => {
  assert.throws(() =>
    imageDimensions(new TextEncoder().encode("<svg></svg>").buffer),
  );
  assert.throws(() => imageDimensions(new Uint8Array(40).buffer));
});
