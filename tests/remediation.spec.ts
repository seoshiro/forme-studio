import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import JSZip from "jszip";
import type { BoardDocument } from "../src/model";

test("F-003 rapid Escape Enter cannot steal focus from reopened layers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Закрыть материалы", exact: true })
    .click();
  await page.locator('.mobile-editor-tabs button[data-panel="layers"]').click();
  await page.evaluate(() => {
    const frame = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) =>
      frame((time) => setTimeout(() => callback(time), 200));
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  // Exercise a delayed close callback after the new panel has rendered.
  await page.waitForTimeout(300);
  await expect(page.locator(".sidebar-tabs")).toBeFocused();
  await expect(page.locator(".editor-sidebar.mobile-open")).toBeVisible();
});

async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая коллекция", exact: true })
    .click();
  await page
    .getByLabel("Название коллекции", { exact: true })
    .fill("Remediation");
  await page
    .getByRole("button", { name: "Создать коллекцию", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Добавить изображения", exact: true }),
  ).toBeEnabled();
}
async function stores(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    const read = (name: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const q = db.transaction(name).objectStore(name).getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    const projects = (await read("projects")) as BoardDocument[];
    const images = ((await read("images")) as { id: string; blob: Blob }[]).map(
      (i) => ({ id: i.id, size: i.blob.size }),
    );
    db.close();
    return { projects, images };
  });
}
async function doc(page: Page) {
  return (await stores(page)).projects.find(
    (p) => p.id === page.url().split("/project/")[1]?.split("/")[0],
  )!;
}
async function board(page: Page) {
  await page.getByRole("button", { name: "Доска", exact: true }).click();
}
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText(/Сохранено/);
}
async function rejected(page: Page, bytes: Buffer, name: string) {
  const before = await stores(page);
  const oldURL = page.url();
  await page.getByLabel("Импорт архива FORME", { exact: true }).setInputFiles({
    name: name + ".forme",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await page.waitForFunction(
    (url) =>
      Boolean(document.querySelector(".global-error")) || location.href !== url,
    oldURL,
  );
  await expect(page.locator(".global-error")).toBeVisible();
  expect(await stores(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Закрыть сообщение об ошибке" })
    .click();
}
test("F-001 ZIP parser differential rejects before any writes", async ({
  page,
}) => {
  await create(page);
  await rejected(
    page,
    await fs.readFile("tests/fixtures/undercounted-deflate.forme"),
    "undercounted",
  );
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(await doc(page)));
  for (let i = 0; i < 310; i++)
    zip.file(`images/extra${i}`, "x", { createFolders: false });
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const end = bytes.lastIndexOf(Buffer.from([80, 75, 5, 6]));
  bytes.writeUInt16LE(1, end + 8);
  bytes.writeUInt16LE(1, end + 10);
  await rejected(page, bytes, "entry-count");
});
test("F-002 pending upload survives navigation and competing writer", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      setTimeout(
        () =>
          post.call(
            this,
            message,
            Array.isArray(options) ? { transfer: options } : options,
          ),
        1000,
      );
    };
  });
  await create(page);
  const url = page.url();
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles(["public/images/photo-1.jpg", "public/images/photo-2.jpg"]);
  await expect(page.locator(".save-status")).not.toHaveText(/Сохранено/);
  await expect
    .poll(async () => (await stores(page)).projects[0].materials.length)
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "FORME — на главную" }).click();
  await expect(
    page.getByRole("button", { name: "Открыть студию", exact: true }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(url);
  await board(second);
  await second.getByRole("button", { name: "Заметка", exact: true }).click();
  await saved(second);
  expect((await doc(second)).materials).toHaveLength(2);
  expect((await doc(second)).objects).toHaveLength(1);
  await second.close();
});
test("F-003 mobile keyboard panel keeps focus visible and Escape restores it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Закрыть материалы" }).click();
  const note = page.getByRole("button", {
    name: "Объект: Направление",
    exact: true,
  });
  for (
    let i = 0;
    i < 60 && !(await note.evaluate((e) => e === document.activeElement));
    i++
  )
    await page.keyboard.press("Tab");
  await expect(note).toBeFocused();
  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const e = document.activeElement as HTMLElement,
          r = e.getBoundingClientRect();
        const at = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return e !== document.body && !!at && (e === at || e.contains(at));
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".properties.mobile-open")).toHaveCount(0);
  await expect(note).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(note).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(note).toBeFocused();
});
test("F-004 foreign blob reference rejected atomically", async ({ page }) => {
  await create(page);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles("public/images/photo-1.jpg");
  await expect(page.locator(".material-card")).toHaveCount(1);
  await saved(page);
  const d = await doc(page);
  const blobId = d.materials[0].blobId;
  d.materials = [
    {
      id: "note",
      type: "note",
      title: "Note",
      text: "text",
      blobId,
      tags: [],
      colors: [],
      favorite: false,
    },
  ];
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(d));
  await rejected(
    page,
    await zip.generateAsync({ type: "nodebuffer" }),
    "foreign-blob",
  );
});
test("F-005 focused draft persists and rejected coordinate is canonical", async ({
  page,
}) => {
  await create(page);
  await board(page);
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await saved(page);
  await page
    .getByLabel("Название объекта", { exact: true })
    .fill("Последний ввод");
  await saved(page);
  await page.reload();
  expect((await doc(page)).objects[0].title).toBe("Последний ввод");
  await page
    .getByRole("button", { name: "Объект: Последний ввод", exact: true })
    .click();
  await page.getByLabel("X", { exact: true }).fill("0");
  await page.getByLabel("X", { exact: true }).press("Enter");
  await saved(page);
  await page.getByLabel("X", { exact: true }).fill("-5");
  await page.getByLabel("X", { exact: true }).press("Enter");
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("0");
  expect((await doc(page)).objects[0].x).toBe(0);
});
test("F-006 no-op commands preserve useful undo", async ({ page }) => {
  await create(page);
  await board(page);
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await page.getByLabel("X", { exact: true }).fill("0");
  await page.getByLabel("X", { exact: true }).press("Enter");
  await saved(page);
  await page
    .getByRole("button", { name: "Объект: Мысль на полях", exact: true })
    .focus();
  for (let i = 0; i < 85; i++) await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  expect((await doc(page)).objects).toHaveLength(0);
});
test("F-007 discarded upload blobs collected after history closes", async ({
  page,
}) => {
  await create(page);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles([
      "public/images/photo-1.jpg",
      "public/images/photo-2.jpg",
      "public/images/photo-3.jpg",
    ]);
  await expect(page.locator(".material-card")).toHaveCount(3);
  await saved(page);
  await board(page);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await saved(page);
  expect((await doc(page)).materials).toHaveLength(1);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect.poll(async () => (await stores(page)).images.length).toBe(0);
});
test("F-008 object limit gives feedback without pageerror", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  await board(page);
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await saved(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => r(q.result);
    });
    await new Promise<void>((r) => {
      const tx = db.transaction("projects", "readwrite"),
        s = tx.objectStore("projects"),
        q = s.get(location.hash.split("/")[2]);
      q.onsuccess = () => {
        const d = q.result;
        d.objects = Array.from({ length: 500 }, (_, i) => ({
          ...d.objects[0],
          id: "o" + i,
        }));
        d.revision++;
        s.put(d);
      };
      tx.oncomplete = () => r();
    });
    db.close();
  });
  await page.reload();
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/500/);
  expect(errors).toEqual([]);
  expect((await doc(page)).objects).toHaveLength(500);
});
test("F-009 PNG preserves spaces tabs and note padding", async ({
  page,
}, info) => {
  await create(page);
  await board(page);
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  const text = "A    B\n    C\nD\tE\nПривет 🧪";
  await page.getByLabel("Текст заметки", { exact: true }).fill(text);
  await saved(page);
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    (window as unknown as { draws: [string, number, number][] }).draws = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      ...args: Parameters<CanvasRenderingContext2D["fillText"]>
    ) {
      (window as unknown as { draws: [string, number, number][] }).draws.push([
        args[0],
        args[1],
        args[2],
      ]);
      return original.apply(this, args);
    };
  });
  await page.screenshot({ path: "docs/remediation/note-editor.png" });
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Мудборд в PNG/ }).click();
  await (await download).saveAs("docs/remediation/note-export.png");
  const draws = await page.evaluate(
    () => (window as unknown as { draws: [string, number, number][] }).draws,
  );
  expect(draws.map((d) => d[0])).toContain("A    B");
  expect(draws.map((d) => d[0])).toContain("    C");
  expect(draws[0][1]).toBe(104);
  await info.attach("canvas-draws", {
    body: JSON.stringify(draws),
    contentType: "application/json",
  });
});
test("F-011 URL error associates field and restores correction focus", async ({
  page,
}) => {
  await create(page);
  await page
    .getByRole("button", { name: "Заметка или ссылка", exact: true })
    .click();
  await page.getByRole("button", { name: "Ссылка", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Ссылка");
  await page.getByLabel("URL", { exact: true }).fill("javascript:alert(1)");
  await page
    .getByRole("button", { name: "Сохранить находку", exact: true })
    .click();
  await expect(page.getByLabel("URL", { exact: true })).toBeFocused();
  await expect(page.getByLabel("URL", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByLabel("URL", { exact: true }),
  ).toHaveAccessibleDescription(/http/);
});

test("hostile archive corpus rejects atomically; ordinary HTML text stays inert", async ({
  page,
}, info) => {
  await create(page);
  const initial = await doc(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const make = async (
    d: unknown,
    entries: [string, Buffer | string][] = [],
  ) => {
    const z = new JSZip();
    z.file("manifest.json", typeof d === "string" ? d : JSON.stringify(d));
    for (const [name, bytes] of entries)
      z.file(name, bytes, { createFolders: false });
    return z.generateAsync({ type: "nodebuffer", compression: "STORE" });
  };
  const image = {
    id: "image",
    type: "image",
    title: "Image",
    blobId: "a",
    tags: [],
    colors: [],
    favorite: false,
    width: 80,
    height: 80,
  };
  const cases: [string, Buffer][] = [
    ["traversal", await make(initial, [["../evil", "x"]])],
    ["absolute", await make(initial, [["/etc/file", "x"]])],
    ["windows-path", await make(initial, [["C:\\file", "x"]])],
    ["corrupt-zip", Buffer.from("not a zip")],
    ["corrupt-manifest", await make("{oops")],
    ["version", await make({ ...initial, schemaVersion: 999 })],
    [
      "prototype",
      await make(
        JSON.stringify(initial).replace(
          '"schemaVersion":1',
          '"__proto__":{"polluted":true},"schemaVersion":1',
        ),
      ),
    ],
    [
      "constructor",
      await make({
        ...initial,
        constructor: { prototype: { polluted: true } },
      }),
    ],
    [
      "oversized-entry",
      await make(initial, [["images/a", Buffer.alloc(10 * 1024 * 1024 + 1)]]),
    ],
    ["missing-image", await make({ ...initial, materials: [image] })],
    [
      "malformed-image",
      await make({ ...initial, materials: [image] }, [
        ["images/a", "not an image"],
      ]),
    ],
    [
      "svg-disguised",
      await make({ ...initial, materials: [image] }, [
        [
          "images/a",
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
        ],
      ]),
    ],
    [
      "excessive-images",
      await make({
        ...initial,
        materials: Array.from({ length: 301 }, (_, i) => ({
          ...image,
          id: `m${i}`,
          blobId: `b${i}`,
        })),
      }),
    ],
    [
      "repeated-blob",
      await make(
        { ...initial, materials: [image, { ...image, id: "second" }] },
        [["images/a", await fs.readFile("public/images/photo-1.jpg")]],
      ),
    ],
  ];
  const pair = await make(initial, [
    ["images/a", "a"],
    ["images/b", "b"],
  ]);
  const duplicate = Buffer.from(pair);
  for (
    let i = 0;
    (i = duplicate.indexOf(Buffer.from("images/b"), i)) !== -1;
    i += 8
  )
    Buffer.from("images/a").copy(duplicate, i);
  cases.push(["duplicate-paths", duplicate]);
  const mismatch = Buffer.from(pair);
  Buffer.from("../evilx").copy(
    mismatch,
    mismatch.indexOf(Buffer.from("images/a")),
  );
  cases.push(["local-path-mismatch", mismatch]);
  const eocd = pair.lastIndexOf(Buffer.from([80, 75, 5, 6]));
  for (const [name, offset, value] of [
    ["count-mismatch", eocd + 8, 1],
    ["central-length", eocd + 12, 0],
    ["descriptor", 6, 8],
  ] as const) {
    const b = Buffer.from(pair);
    b.writeUInt16LE(value, offset);
    cases.push([name, b]);
  }
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 80;
      return c.toDataURL().split(",")[1];
    }),
    "base64",
  );
  png.writeUInt32BE(10000, 16);
  png.writeUInt32BE(10000, 20);
  cases.push([
    "oversized-pixels",
    await make({ ...initial, materials: [image] }, [["images/a", png]]),
  ]);
  for (const [name, bytes] of cases) await rejected(page, bytes, name);
  const huge = info.outputPath("oversized.forme");
  await fs.mkdir(info.outputDir, { recursive: true });
  const handle = await fs.open(huge, "w");
  await handle.truncate(210 * 1024 * 1024 + 1);
  await handle.close();
  const before = await stores(page);
  try {
    await page
      .getByLabel("Импорт архива FORME", { exact: true })
      .setInputFiles(huge);
    await expect(page.locator(".global-error")).toContainText("210");
    expect(await stores(page)).toEqual(before);
  } finally {
    await fs.unlink(huge);
  }
  await page
    .getByRole("button", { name: "Закрыть сообщение об ошибке" })
    .click();
  const payload =
    '<img src=x onerror="window.pwned=true"><script>alert(1)</script>';
  await page.getByLabel("Импорт архива FORME", { exact: true }).setInputFiles({
    name: "text.forme",
    mimeType: "application/zip",
    buffer: await make({ ...initial, name: payload }),
  });
  await expect(page.locator(".project-switch")).toContainText(payload);
  expect(
    await page.evaluate(() => ({
      polluted: ({} as { polluted?: boolean }).polluted,
      injected: document.querySelector("img[onerror]") !== null,
    })),
  ).toEqual({ polluted: undefined, injected: false });
  expect(errors).toEqual([]);
  await info.attach("corpus", {
    body: JSON.stringify(
      cases
        .map(([name]) => name)
        .concat("oversized-archive", "inert-html-positive"),
    ),
    contentType: "application/json",
  });
});

test("re-audit: navigation cannot close a session while another upload starts", async ({
  page,
}) => {
  await create(page);
  await board(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const tx = original.apply(this, args);
      Object.defineProperty(tx, "oncomplete", {
        set(fn: (e: Event) => void) {
          tx.addEventListener("complete", (e) =>
            setTimeout(() => fn.call(tx, e), 800),
          );
        },
      });
      return tx;
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await page.evaluate(() => {
    location.hash = "";
  });
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles("public/images/photo-1.jpg");
  await expect(
    page.getByRole("button", { name: "Открыть студию", exact: true }),
  ).toBeVisible();
  const data = await stores(page);
  expect(data.projects[0].objects).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("re-audit: losing decoder cannot delete a blob committed by another tab", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  await create(page);
  const url = page.url();
  const bytes = [...(await fs.readFile("public/images/photo-1.jpg"))];
  await page.evaluate(async (bytes) => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open("forme-studio");
      q.onsuccess = () => r(q.result);
    });
    await new Promise<void>((r) => {
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").put({
        id: "queue-race",
        blob: new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
        thumbnail: new Blob(),
        upload: { projectId: location.hash.split("/")[2], name: "queued.jpg" },
      });
      tx.oncomplete = () => r();
    });
    db.close();
  }, bytes);
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      setTimeout(
        () =>
          post.call(
            this,
            message,
            Array.isArray(options) ? { transfer: options } : options,
          ),
        700,
      );
    };
  });
  const second = await context.newPage();
  await second.addInitScript(() => {
    Worker.prototype.postMessage = function () {
      setTimeout(() => this.dispatchEvent(new Event("error")), 1600);
    };
  });
  await Promise.all([page.reload(), second.goto(url)]);
  await expect(page.locator(".material-card")).toHaveCount(1);
  await saved(page);
  await expect(second.locator(".global-error")).toBeVisible();
  const data = await stores(page);
  expect(data.projects[0].materials[0].blobId).toBe("queue-race");
  expect(data.images.some((i) => i.id === "queue-race")).toBe(true);
  await page.reload();
  await expect(page.locator(".material-card img")).toBeVisible();
  await second.close();
});

test("F-002 staged raw uploads recover after accepted reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      setTimeout(
        () =>
          post.call(
            this,
            message,
            Array.isArray(options) ? { transfer: options } : options,
          ),
        1200,
      );
    };
  });
  await create(page);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles(["public/images/photo-1.jpg", "public/images/photo-2.jpg"]);
  await expect.poll(async () => (await stores(page)).images.length).toBe(2);
  let warnings = 0;
  page.on("dialog", async (d) => {
    expect(d.type()).toBe("beforeunload");
    warnings++;
    await d.accept();
  });
  await page.reload();
  await expect(page.locator(".material-card")).toHaveCount(2);
  await saved(page);
  expect(warnings).toBe(1);
  expect((await doc(page)).materials).toHaveLength(2);
  await page.reload();
  expect((await doc(page)).materials).toHaveLength(2);
});

test("F-002 conflicted upload stays open with complete recovery bytes", async ({
  page,
  context,
}, info) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      setTimeout(
        () =>
          post.call(
            this,
            message,
            Array.isArray(options) ? { transfer: options } : options,
          ),
        1000,
      );
    };
  });
  await create(page);
  const url = page.url();
  const second = await context.newPage();
  await second.goto(url);
  await board(second);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles(["public/images/photo-1.jpg", "public/images/photo-2.jpg"]);
  await expect.poll(async () => (await stores(page)).images.length).toBe(2);
  await second.getByRole("button", { name: "Заметка", exact: true }).click();
  await saved(second);
  await expect(page.locator(".error-banner")).toContainText("другой вкладке");
  await page.getByRole("button", { name: "FORME — на главную" }).click();
  await expect(page.locator(".global-error")).toBeVisible();
  expect(page.url()).toBe(url);
  const d = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать резервную копию", exact: true })
    .click();
  const file = info.outputPath("recovery.forme");
  await (await d).saveAs(file);
  const z = await JSZip.loadAsync(await fs.readFile(file));
  const manifest = JSON.parse(
    await z.file("manifest.json")!.async("string"),
  ) as BoardDocument;
  expect(manifest.materials).toHaveLength(2);
  for (let i = 0; i < 2; i++)
    expect(
      await z
        .file(`images/${manifest.materials[i].blobId}`)!
        .async("nodebuffer"),
    ).toEqual(await fs.readFile(`public/images/photo-${i + 1}.jpg`));
  expect((await doc(second)).objects).toHaveLength(1);
  await second.close();
});

test("F-010 distributable includes full third-party license notices", async ({
  request,
}) => {
  const licenses = await request.get("/THIRD_PARTY_NOTICES.md");
  expect(licenses.status()).toBe(200);
  const text = await licenses.text();
  for (const name of [
    "react-dom",
    "react",
    "scheduler",
    "lucide-react",
    "jszip",
    "Feather",
    "Permission is hereby granted",
  ])
    expect(text).toContain(name);
  const supplemental = await request.get("/JSZIP_THIRD_PARTY_NOTICES.txt");
  expect(supplemental.status()).toBe(200);
  const content = await supplemental.text();
  for (const name of [
    "pako",
    "readable-stream",
    "lie",
    "string_decoder",
    "Copyright",
  ])
    expect(content).toContain(name);
});

test("F-012 short viewport pointer choice and F-013 readable empty hint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 683, height: 384 });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Открыть пример «Тихая архитектура»",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Закрыть материалы" }).click();
  await page
    .getByRole("button", { name: "Объект: Направление", exact: true })
    .click();
  await expect(
    page.getByLabel("Название объекта", { exact: true }),
  ).toHaveValue("Направление");
  await page.setViewportSize({ width: 390, height: 480 });
  const close = page.getByRole("button", {
    name: "Закрыть свойства",
    exact: true,
  });
  await expect(close).toBeInViewport();
  await close.click();
  await create(page);
  await board(page);
  await page.getByRole("button", { name: "Закрыть материалы" }).click();
  expect(
    await page
      .locator(".canvas-empty small")
      .evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  expect(
    await page
      .locator(".canvas-empty")
      .evaluate((e) => e.closest(".board-scene")),
  ).toBeNull();
});

test("re-audit: valid multi-megabyte note manifest round-trips", async ({
  page,
}, info) => {
  await create(page);
  const d = await doc(page);
  const text = "Ж".repeat(3000);
  d.objects = Array.from({ length: 400 }, (_, i) => ({
    id: `note-${i}`,
    type: "note",
    title: `Note ${i}`,
    text,
    fontSize: 20,
    color: "#ffffff",
    x: 0,
    y: 0,
    width: 300,
    height: 300,
  }));
  const z = new JSZip();
  z.file("manifest.json", JSON.stringify(d));
  const bytes = await z.generateAsync({ type: "nodebuffer" });
  expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
  await page.getByLabel("Импорт архива FORME", { exact: true }).setInputFiles({
    name: "long-notes.forme",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await expect(page.locator(".scene-object")).toHaveCount(400);
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Полный архив/ }).click();
  const file = info.outputPath("long-notes.forme");
  await (await download).saveAs(file);
  const result = await JSZip.loadAsync(await fs.readFile(file));
  const manifest = JSON.parse(
    await result.file("manifest.json")!.async("string"),
  ) as BoardDocument;
  expect(manifest.objects).toHaveLength(400);
  expect(manifest.objects.every((o) => o.text === text)).toBe(true);
  await page.keyboard.press("Escape");
  await page
    .getByLabel("Импорт архива FORME", { exact: true })
    .setInputFiles(file);
  await expect(page.locator(".scene-object")).toHaveCount(400);
  await expect.poll(async () => (await stores(page)).projects.length).toBe(3);
});

test("F-007 live tab retains undo blobs while another tab starts", async ({
  page,
  context,
}) => {
  await create(page);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles("public/images/photo-1.jpg");
  await expect(page.locator(".material-card")).toHaveCount(1);
  await saved(page);
  await board(page);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "Открыть студию", exact: true })
    .click();
  expect((await stores(second)).images).toHaveLength(1);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await saved(page);
  expect((await doc(page)).materials).toHaveLength(1);
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".material-card img")
        .evaluateAll((imgs) =>
          imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await second.close();
});

test("F-002 raw upload quota failure is atomic and visible", async ({
  page,
}) => {
  await create(page);
  const before = await stores(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "images")
        throw new DOMException("Quota test", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles("public/images/photo-1.jpg");
  await expect(page.locator(".global-error")).toBeVisible();
  expect(await stores(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("re-audit: departure excludes new field drafts and finishes navigation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      setTimeout(
        () =>
          post.call(
            this,
            message,
            Array.isArray(options) ? { transfer: options } : options,
          ),
        1500,
      );
    };
  });
  await create(page);
  await board(page);
  await page.getByRole("button", { name: "Заметка", exact: true }).click();
  await saved(page);
  await page
    .getByLabel("Загрузить изображения", { exact: true })
    .setInputFiles("public/images/photo-1.jpg");
  await page.getByRole("button", { name: "FORME — на главную" }).click();
  if (
    !(await page
      .locator("#main-content")
      .evaluate((e) => (e as HTMLElement).inert))
  )
    await page
      .getByLabel("Название объекта", { exact: true })
      .fill("During departure");
  await expect(
    page.getByRole("button", { name: "Открыть студию", exact: true }),
  ).toBeVisible();
  const data = await stores(page);
  expect(data.projects[0].materials).toHaveLength(1);
  expect(data.projects[0].objects).toHaveLength(1);
});
