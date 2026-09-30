# Engineering & verification

FORME is a browser application with static hosting and no application backend. This note describes the released implementation and the scope of its checks as of 30 September 2026.

## Data and editing

`App.tsx` owns a `ProjectSession` shared by the library, editor, and design kit. Commands update a validated document model; an 80-step undo history stores metadata, not image buffers. Pointer gestures commit once on completion. Reload restores the latest saved document, but not the session's undo stack.

Native IndexedDB stores documents, original image blobs, and a durable upload queue. Files enter that queue before decoding. A worker validates raster input, creates thumbnails, and extracts deterministic palettes. “Saved” follows transaction completion. Write failures remain visible and allow a recovery export.

Web Locks coordinate editing sessions; revision checks reject stale writes. Conflicting edits remain available for recovery export. Without Web Locks, orphan-image cleanup is deferred to protect other tabs' history, which can increase storage use.

## Export and import boundaries

The board uses focusable DOM elements. A separate Canvas2D renderer produces the complete 1400 × 1000 PNG from document geometry and original images, independently of the visible viewport.

The design kit ZIP contains `tokens.json`, `theme.css`, and `DESIGN.md`. It includes color roles and typography choices, not bundled font files or a generated website.

A versioned `.forme` ZIP STORE archive contains the document and original image bytes. Import checks ZIP headers, paths, entry counts, sizes, CRC, manifest schema, and image ownership before the final write transaction. It assigns new project and image IDs. Compressed, encrypted, ZIP64, SVG, and HTML payloads are rejected. Raster signatures and pixel limits are checked before decoding.

Current limits: 300 materials, 500 board objects, 10 MiB / 40 megapixels per image, 20 MiB manifest, 200 MiB archive contents, and 210 MiB input archive. Projects are scoped to the browser profile and origin; exported archives provide portability.

## What was verified

The [publication CI run](https://github.com/seoshiro/forme-studio/actions/runs/36681313108) passed against commit `eff5fecb71ae4a50cd4672751797857d0c8cd496`. Documentation changes after that commit do not expand the browser-support claims below. Current runs are available in [GitHub Actions](https://github.com/seoshiro/forme-studio/actions).

- **PASS — reproducible build:** clean `npm ci`, lint, TypeScript checking, 8 unit tests, production build, and 32 Playwright tests in CI.
- **PASS — browser regressions:** reload persistence, undo/redo, failed writes, conflicting tabs, image ingestion, hostile archive input, and export/import behavior. PNG dimensions and original/restored image hashes are checked separately.
- **PASS — viewport checks:** landing, library, editor, and kit at 390, 768, 1366, and 1920 px in Chrome, with screenshots inspected and axe scans. This is the full four-width matrix, not full cross-browser coverage.
- **PASS — additional engines:** the upload/edit/reload/kit/PNG/archive/restore workflow smoke passed in bundled Chromium and Firefox. The full 32-test suite was not run in Firefox.
- **PASS — public deployment:** an isolated Chrome workflow on the HTTPS demo verified PNG output and byte-identical archive restoration in a clean browser context. Eight axe scans across four screens at 390 and 1366 px reported no violations; automated-review items still require human assessment.
- **BLOCKED — WebKit:** the Windows runner lacked native `zlib1.dll`, `libsharpyuv.dll`, and `jxl.dll`. No Safari or WebKit pass is claimed.
- **NOT_RUN — physical devices and screen readers:** automated accessibility results do not establish complete accessibility conformance.

A supplemental 683 × 384 viewport check found undersized palette swatches; the Layers list provides larger equivalent selection controls. The four target-width axe scans were clean. Contrast shown by the kit is advisory and does not certify a downstream design.

## Reproduce the checks

Use Node.js 24 and the committed lockfile. Start the production preview in one terminal:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run preview
```

In a second terminal, with Google Chrome installed:

```sh
npm run test:e2e
node scripts/verify-artifacts.mjs
```

The optional published-origin smoke uses isolated browser contexts and creates its own demo data:

```sh
node scripts/production-smoke.mjs https://forme-studio-coral.vercel.app
```

See [the CI workflow](../.github/workflows/verify.yml), [browser tests](../tests), and [artifact verifier](../scripts/verify-artifacts.mjs) for executable evidence. Generated browser profiles, downloads, and local audit artifacts are excluded from the repository.
