import { test, expect } from "@playwright/test";
import type { ProjectSession } from "../src/storage";
import { createServer, type ViteDevServer } from "vite";

let integrationServer: ViteDevServer;
let integrationOrigin: string;
test.beforeAll(async () => {
  // Exercise browser-only modules without making production E2E depend on /src URLs.
  integrationServer = await createServer({
    configFile: false,
    cacheDir: "node_modules/.vite-audit-data",
    server: {
      host: "127.0.0.1",
      port: 0,
      watch: { ignored: ["**/docs/**", "**/test-results*/**"] },
    },
  });
  await integrationServer.listen();
  const address = integrationServer.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Integration server unavailable");
  integrationOrigin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await integrationServer?.close();
});

test("a timed-out image worker is replaced before the next attempt", async ({
  page,
}) => {
  await page.goto(integrationOrigin);
  const result = await page.evaluate(async () => {
    const realWorker = window.Worker;
    const realTimeout = window.setTimeout;
    let created = 0;
    let terminated = 0;
    class StalledWorker {
      onmessage = null;
      onerror = null;
      constructor() {
        created++;
      }
      postMessage() {
        /* A decode that never completes. */
      }
      terminate() {
        terminated++;
      }
    }
    window.Worker = StalledWorker as unknown as typeof Worker;
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) =>
      realTimeout(
        handler,
        timeout === 30000 ? 5 : timeout,
        ...args,
      )) as typeof window.setTimeout;
    try {
      const modulePath = "/src/images.ts";
      const { processImage } = await import(/* @vite-ignore */ modulePath);
      const attempt = async () => {
        try {
          await processImage(new Blob(["stalled"]));
          return "";
        } catch (error) {
          return (error as Error).message;
        }
      };
      const failures = await Promise.all([attempt(), attempt()]);
      failures.push(await attempt());
      return { created, terminated, failures };
    } finally {
      window.Worker = realWorker;
      window.setTimeout = realTimeout;
    }
  });
  expect(result.failures).toHaveLength(3);
  expect(result.failures.every(Boolean)).toBe(true);
  expect(result.created).toBe(2);
  expect(result.terminated).toBe(2);
});

test("decoded image resources are released when thumbnail encoding fails", async ({
  page,
}) => {
  await page.goto(integrationOrigin);
  const result = await page.evaluate(async () => {
    const source = `
      let closed = 0;
      globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() { closed++; } });
      globalThis.OffscreenCanvas = class {
        constructor(width, height) { this.width = width; this.height = height; }
        getContext() { return { drawImage() {} }; }
        async convertToBlob() { throw new Error("Synthetic encoder failure"); }
      };
      const post = self.postMessage.bind(self);
      self.postMessage = data => post({ ...data, closed });
      await import(${JSON.stringify(new URL("/src/image.worker.ts", location.href).href)});
      post({ ready: true });
    `;
    const url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    const worker = new Worker(url, { type: "module" });
    try {
      return await new Promise<{ error: string; closed: number }>(
        (resolve, reject) => {
          worker.onerror = (event) => reject(new Error(event.message));
          worker.onmessage = ({ data }) => {
            if (data.ready) {
              const bytes = new Uint8Array(24);
              bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
              const view = new DataView(bytes.buffer);
              view.setUint32(16, 1);
              view.setUint32(20, 1);
              worker.postMessage({ id: 1, file: new Blob([bytes]) });
            } else resolve(data);
          };
        },
      );
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });
  expect(result.error).toBe("Synthetic encoder failure");
  expect(result.closed).toBe(1);
});

test("PNG export releases decoded image resources after a canvas failure", async ({
  page,
}) => {
  await page.goto(integrationOrigin);
  const result = await page.evaluate(async () => {
    const modelPath = "/src/model.ts";
    const exportsPath = "/src/exports.ts";
    const { blankProject } = await import(/* @vite-ignore */ modelPath);
    const { pngBlob } = await import(/* @vite-ignore */ exportsPath);
    const doc = blankProject("Canvas failure");
    doc.materials = [
      {
        id: "asset",
        type: "image",
        title: "Image",
        tags: [],
        favorite: false,
        colors: [],
        blobId: "blob",
        width: 1,
        height: 1,
      },
    ];
    doc.objects = [
      {
        id: "object",
        type: "image",
        title: "Image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        assetId: "asset",
      },
    ];
    const decode = window.createImageBitmap;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    let closed = 0;
    window.createImageBitmap = (async () => ({
      width: 1,
      height: 1,
      close() {
        closed++;
      },
    })) as unknown as typeof createImageBitmap;
    CanvasRenderingContext2D.prototype.drawImage = () => {
      throw new Error("Synthetic canvas failure");
    };
    try {
      await pngBlob({
        doc,
        image: async () => ({ blob: new Blob() }),
      } as unknown as ProjectSession);
      return { error: "", closed };
    } catch (error) {
      return { error: (error as Error).message, closed };
    } finally {
      window.createImageBitmap = decode;
      CanvasRenderingContext2D.prototype.drawImage = draw;
    }
  });
  expect(result.error).toBe("Synthetic canvas failure");
  expect(result.closed).toBe(1);
});

test("valid JPEG marker padding passes preflight and worker processing", async ({
  page,
}) => {
  await page.goto(integrationOrigin);
  const result = await page.evaluate(async () => {
    const original = new Uint8Array(
      await (await fetch("/images/photo-1.jpg")).arrayBuffer(),
    );
    const padded = new Uint8Array(original.length + 1);
    padded.set(original.subarray(0, 2));
    padded[2] = 255;
    padded.set(original.subarray(2), 3);
    const file = new Blob([padded], { type: "image/jpeg" });
    const decoded = await createImageBitmap(file);
    const actual = { width: decoded.width, height: decoded.height };
    decoded.close();
    const headerPath = "/src/image-header.ts";
    const imagesPath = "/src/images.ts";
    const { imageDimensions } = await import(/* @vite-ignore */ headerPath);
    const { processImage } = await import(/* @vite-ignore */ imagesPath);
    const header = imageDimensions(padded.buffer);
    const processed = await processImage(file);
    return {
      actual,
      header,
      processed: { width: processed.width, height: processed.height },
    };
  });
  expect(result.header).toEqual({ ...result.actual, mime: "image/jpeg" });
  expect(result.processed).toEqual(result.actual);
});

test("upload queue preserves native asynchronous errors and rolls back the batch", async ({
  page,
}) => {
  await page.goto(integrationOrigin);
  const result = await page.evaluate(async () => {
    const modelPath = "/src/model.ts";
    const storagePath = "/src/storage.ts";
    const { blankProject } = await import(/* @vite-ignore */ modelPath);
    const { writeProject, queueUploads, loadProject } = await import(
      /* @vite-ignore */ storagePath
    );
    const doc = blankProject("Native upload failure");
    doc.revision = await writeProject(doc, 0);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("forme-studio");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").put({
        id: "existing-image",
        blob: new Blob(["original"]),
        thumbnail: new Blob(["thumbnail"]),
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const readImages = async () => {
      const images = await new Promise<
        { id: string; blob: Blob; thumbnail: Blob }[]
      >((resolve, reject) => {
        const request = db.transaction("images").objectStore("images").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return Promise.all(
        images.map(async (image) => ({
          id: image.id,
          blob: await image.blob.text(),
          thumbnail: await image.thumbnail.text(),
        })),
      );
    };
    const before = {
      project: await loadProject(doc.id),
      images: await readImages(),
    };
    const describe = (error: unknown) =>
      error instanceof DOMException || error instanceof Error
        ? { name: error.name, message: error.message }
        : null;
    let requestError: ReturnType<typeof describe> = null;
    let rejection: ReturnType<typeof describe> = null;
    let inserted = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name !== "images" || ++inserted !== 2)
        return put.call(this, value, key);
      const request = this.add({
        ...(value as Record<string, unknown>),
        id: "existing-image",
      });
      request.addEventListener("error", () => {
        requestError = describe(request.error);
      });
      return request;
    };
    try {
      await queueUploads(doc, [
        new File(["first"], "first.jpg"),
        new File(["second"], "second.jpg"),
      ]);
    } catch (error) {
      rejection = describe(error);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const after = {
      project: await loadProject(doc.id),
      images: await readImages(),
    };
    db.close();
    return {
      before,
      after,
      requestError: requestError as ReturnType<typeof describe>,
      rejection,
      inserted,
    };
  });
  expect(result.inserted).toBe(2);
  expect(result.requestError?.name).toBe("ConstraintError");
  expect(result.requestError?.message).toBeTruthy();
  expect(result.rejection).toEqual(result.requestError);
  expect(result.after).toEqual(result.before);
});
