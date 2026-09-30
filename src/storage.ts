import { clone, History, validateDocument, type BoardDocument } from "./model";
export type StoredImage = {
  id: string;
  blob: Blob;
  thumbnail: Blob;
  upload?: { projectId: string; name: string };
};
let dbPromise: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("forme-studio", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("projects", { keyPath: "id" });
      db.createObjectStore("images", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = undefined;
        workspaceDB = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      dbPromise = undefined;
      reject(request.error);
    };
    request.onblocked = () =>
      reject(new Error("Закройте старые вкладки FORME и повторите открытие."));
  }));
}
let workspaceDB: Promise<IDBDatabase> | undefined;
let workspaceLease: Promise<void> | undefined;
function database() {
  return (workspaceDB ??= openDatabase()
    .then(async (db) => {
      if (navigator.locks) {
        workspaceLease ??= (async () => {
          await navigator.locks.request(
            "forme-live-tabs",
            { ifAvailable: true },
            async (lock) => {
              if (!lock) return;
              // An older tab may hold a project lock without the workspace lease.
              if (
                (await navigator.locks.query()).held?.some((l) =>
                  l.name?.startsWith("forme-project-"),
                )
              )
                return;
              await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(["projects", "images"], "readwrite");
                const q = tx.objectStore("projects").getAll();
                q.onsuccess = () => {
                  const docs = q.result as BoardDocument[];
                  const refs = new Set(
                    docs.flatMap((d) =>
                      d.materials
                        .filter((m) => m.type === "image")
                        .map((m) => m.blobId),
                    ),
                  );
                  const projects = new Set(docs.map((d) => d.id));
                  const cursor = tx.objectStore("images").openCursor();
                  cursor.onsuccess = () => {
                    const c = cursor.result;
                    if (!c) return;
                    const image = c.value as StoredImage;
                    if (
                      !refs.has(image.id) &&
                      !(image.upload && projects.has(image.upload.projectId))
                    )
                      c.delete();
                    c.continue();
                  };
                };
                tx.oncomplete = () => resolve();
                tx.onerror = tx.onabort = () => reject(tx.error);
              });
            },
          );
          await new Promise<void>((resolve, reject) => {
            void navigator.locks
              .request("forme-live-tabs", { mode: "shared" }, async () => {
                resolve();
                await new Promise<void>(() => {
                  /* Browser releases this lease on page destruction. */
                });
              })
              .catch(reject);
          });
        })().catch((error) => {
          workspaceLease = undefined;
          throw error;
        });
        await workspaceLease;
      }
      // Without Web Locks keep unreachable blobs: another tab may still need them for undo.
      return db;
    })
    .catch((error) => {
      workspaceDB = undefined;
      throw error;
    }));
}

export async function pendingUploads(
  projectId: string,
): Promise<StoredImage[]> {
  const db = await database();
  const images = (await requestValue(
    db.transaction("images").objectStore("images").getAll(),
  )) as StoredImage[];
  return images.filter((image) => image.upload?.projectId === projectId);
}
export async function queueUploads(
  doc: BoardDocument,
  files: File[],
): Promise<StoredImage[]> {
  const db = await database();
  const images = files.map((file) => ({
    id: crypto.randomUUID(),
    blob: file,
    thumbnail: new Blob(),
    upload: { projectId: doc.id, name: file.name },
  }));
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["projects", "images"], "readwrite");
    let error: Error | undefined;
    const q = tx.objectStore("projects").get(doc.id);
    q.onsuccess = () => {
      try {
        if (q.result?.revision !== doc.revision)
          throw new Error(
            "Коллекция изменена в другой вкладке. Обновите её перед загрузкой.",
          );
        for (const image of images) tx.objectStore("images").put(image);
      } catch (problem) {
        error =
          problem instanceof Error
            ? problem
            : new Error("Не удалось сохранить очередь изображений.");
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve();
    // Request errors bubble before the transaction's error is populated.
    tx.onabort = () => reject(error ?? tx.error);
  });
  return images;
}
export async function discardUpload(id: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["projects", "images"], "readwrite");
    const images = tx.objectStore("images"),
      request = images.get(id);
    request.onsuccess = () => {
      if (!(request.result as StoredImage | undefined)?.upload) return;
      const projects = tx.objectStore("projects").getAll();
      projects.onsuccess = () => {
        if (
          !(projects.result as BoardDocument[]).some((d) =>
            d.materials.some((m) => m.type === "image" && m.blobId === id),
          )
        )
          images.delete(id);
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
function requestValue<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function listProjects() {
  const db = await database();
  return (
    (await requestValue(
      db.transaction("projects").objectStore("projects").getAll(),
    )) as BoardDocument[]
  ).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function loadProject(id: string) {
  const db = await database();
  const result = await requestValue(
    db.transaction("projects").objectStore("projects").get(id),
  );
  if (!result) throw new Error("Коллекция не найдена.");
  validateDocument(result);
  return result;
}
export async function loadImage(id: string): Promise<StoredImage> {
  const db = await database();
  const image = await requestValue(
    db.transaction("images").objectStore("images").get(id),
  );
  if (!image)
    throw new Error(
      "Исходное изображение не найдено. Восстановите коллекцию из архива.",
    );
  return image;
}
export async function writeProject(
  doc: BoardDocument,
  expectedRevision: number,
  images: StoredImage[] = [],
): Promise<number> {
  validateDocument(doc);
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["projects", "images"], "readwrite");
    let problem: unknown;
    tx.oncomplete = () => resolve(expectedRevision + 1);
    tx.onerror = () =>
      reject(problem || tx.error || new Error("Ошибка записи."));
    tx.onabort = () =>
      reject(problem || tx.error || new Error("Запись прервана."));
    const projects = tx.objectStore("projects");
    const request = projects.get(doc.id);
    request.onsuccess = () => {
      try {
        const existing = request.result as BoardDocument | undefined;
        if ((existing?.revision ?? 0) !== expectedRevision)
          throw new Error(
            "Эта коллекция уже изменена в другой вкладке. Экспортируйте текущую копию и откройте актуальную.",
          );
        for (const image of images) tx.objectStore("images").put(image);
        projects.put({ ...doc, revision: expectedRevision + 1 });
      } catch (error) {
        problem = error;
        tx.abort();
      }
    };
  });
}
export async function removeProject(id: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["projects", "images"], "readwrite");
    const store = tx.objectStore("projects");
    const request = store.getAll();
    request.onsuccess = () => {
      const projects = request.result as BoardDocument[];
      const target = projects.find((p) => p.id === id);
      const otherRefs = new Set(
        projects
          .filter((p) => p.id !== id)
          .flatMap((p) =>
            p.materials.filter((m) => m.type === "image").map((m) => m.blobId),
          ),
      );
      for (const asset of target?.materials ?? [])
        if (
          asset.type === "image" &&
          asset.blobId &&
          !otherRefs.has(asset.blobId)
        )
          tx.objectStore("images").delete(asset.blobId);
      store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export class ProjectSession {
  doc: BoardDocument;
  status: "saved" | "pending" | "persisting" | "error" | "conflicted" = "saved";
  error = "";
  actionError = "";
  leaving = false;
  readOnly = true;
  lockReady = false;
  history = new History<BoardDocument>();
  private listeners = new Set<() => void>();
  private version = 0;
  private savedVersion = 0;
  private revision: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private task: Promise<void> | undefined;
  private releaseLock: (() => void) | undefined;
  private closed = false;
  private uploadTask: Promise<void> | undefined;
  private drafts = new Map<object, () => void>();
  readonly ready: Promise<void>;
  pendingImages = new Map<string, StoredImage>();
  private channel: BroadcastChannel;
  constructor(doc: BoardDocument) {
    this.doc = doc;
    this.revision = doc.revision;
    this.channel = new BroadcastChannel("forme-changes");
    this.ready = this.acquire();
  }
  private async acquire() {
    if (!navigator.locks) {
      this.readOnly = false;
      this.lockReady = true;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      void navigator.locks
        .request(
          `forme-project-${this.doc.id}`,
          { ifAvailable: true },
          async (lock) => {
            if (this.closed) {
              resolve();
              return;
            }
            this.readOnly = !lock;
            this.lockReady = true;
            this.emit();
            resolve();
            if (lock)
              await new Promise<void>((resolve) => {
                this.releaseLock = resolve;
              });
          },
        )
        .catch(reject);
    });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private counter = 0;
  snapshot = () => this.counter;
  private emit() {
    this.counter++;
    this.listeners.forEach((fn) => fn());
  }
  get dirty() {
    return this.savedVersion !== this.version;
  }
  get unsettled() {
    return this.dirty || !!this.uploadTask || this.drafts.size > 0;
  }
  get hasDrafts() {
    return this.drafts.size > 0;
  }
  setDraft(key: object, resolve: (() => void) | null) {
    if (resolve) this.drafts.set(key, resolve);
    else this.drafts.delete(key);
    this.emit();
  }
  dismissActionError() {
    this.actionError = "";
    this.emit();
  }
  async upload(fn: () => Promise<void>) {
    if (
      this.closed ||
      this.leaving ||
      this.readOnly ||
      !this.lockReady ||
      this.uploadTask
    )
      throw new Error(
        "Дождитесь завершения операции и открытия коллекции для редактирования.",
      );
    this.status = "pending";
    this.uploadTask = Promise.resolve().then(fn);
    this.emit();
    try {
      await this.uploadTask;
    } finally {
      this.uploadTask = undefined;
      if (this.status === "pending")
        this.status = this.dirty ? "persisting" : "saved";
      this.emit();
    }
  }
  async settle() {
    if (this.closed) return;
    do {
      await this.uploadTask;
      for (const resolve of [...this.drafts.values()]) resolve();
      await this.flush();
    } while (this.unsettled);
  }
  async prepareDeparture() {
    if (this.closed) return;
    this.leaving = true;
    this.emit();
    try {
      await this.settle();
    } catch (error) {
      this.cancelDeparture();
      throw error;
    }
  }
  cancelDeparture() {
    if (!this.closed) {
      this.leaving = false;
      this.emit();
    }
  }
  command(edit: (draft: BoardDocument) => void, fromUpload = false) {
    if (this.readOnly || this.closed || (this.leaving && !fromUpload))
      return false;
    const draft = clone(this.doc);
    try {
      edit(draft);
      if (draft.objects.length > 500)
        throw new Error("На доске может быть не больше 500 объектов.");
      if (draft.materials.length > 300)
        throw new Error("В коллекции может быть не больше 300 находок.");
      validateDocument(draft);
    } catch (error) {
      this.actionError =
        error instanceof Error
          ? error.message
          : "Не удалось изменить документ.";
      this.emit();
      return false;
    }
    const hadError = Boolean(this.actionError);
    this.actionError = "";
    if (JSON.stringify(draft) === JSON.stringify(this.doc)) {
      if (hadError) this.emit();
      return true;
    }
    draft.updatedAt = Date.now();
    this.history.push(this.doc);
    this.doc = draft;
    this.changed();
    return true;
  }
  undo() {
    if (
      this.closed ||
      this.leaving ||
      this.readOnly ||
      !this.history.past.length
    )
      return;
    this.doc = this.history.undo(this.doc);
    this.changed();
  }
  redo() {
    if (
      this.closed ||
      this.leaving ||
      this.readOnly ||
      !this.history.future.length
    )
      return;
    this.doc = this.history.redo(this.doc);
    this.changed();
  }
  private changed() {
    this.version++;
    this.status = this.uploadTask ? "pending" : "persisting";
    this.emit();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {
        /* flush exposes the failure through error/status and recovery UI. */
      });
    }, 180);
  }
  async flush(): Promise<void> {
    if (this.closed) throw new Error("Коллекция уже закрыта.");
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.task) {
      await this.task;
      if (this.dirty) return this.flush();
      return;
    }
    if (!this.dirty) return;
    this.task = (async () => {
      while (this.dirty) {
        const version = this.version;
        const doc = clone(this.doc);
        const images = [...this.pendingImages.values()];
        this.status = "persisting";
        this.emit();
        try {
          this.revision = await writeProject(doc, this.revision, images);
          this.savedVersion = version;
          this.doc.revision = this.revision;
          for (const image of images) this.pendingImages.delete(image.id);
          this.channel.postMessage({ id: doc.id, revision: this.revision });
          this.error = "";
          this.status = this.uploadTask
            ? "pending"
            : this.dirty
              ? "persisting"
              : "saved";
          this.emit();
        } catch (error) {
          this.error =
            error instanceof DOMException && error.name === "QuotaExceededError"
              ? "В браузере закончилось место. Экспортируйте архив, освободите место и повторите сохранение."
              : error instanceof Error
                ? error.message
                : "Не удалось сохранить. Экспортируйте архив и повторите попытку.";
          this.status = this.error.includes("другой вкладке")
            ? "conflicted"
            : "error";
          this.emit();
          throw error;
        }
      }
    })();
    try {
      await this.task;
    } finally {
      this.task = undefined;
    }
  }
  async image(id: string) {
    return this.pendingImages.get(id) ?? loadImage(id);
  }
  close() {
    if (this.closed) return;
    if (this.unsettled)
      throw new Error("Нельзя закрыть коллекцию с незавершёнными изменениями.");
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.releaseLock?.();
    this.channel.close();
  }
}
