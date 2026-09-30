import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUpRight,
  Plus,
  Download,
  FolderOpen,
  Undo2,
  Redo2,
  Monitor,
  X,
  ChevronDown,
  Check,
  LoaderCircle,
  Upload,
  ArrowRight,
  HardDrive,
  Image,
  FileArchive,
  Palette,
  AlertCircle,
} from "lucide-react";
import { Brand, IconButton, Modal } from "./components";
import { BoardPreview } from "./Board";
import {
  blankProject,
  clampObject,
  uid,
  type BoardDocument,
  type Material,
} from "./model";
import {
  listProjects,
  loadProject,
  ProjectSession,
  writeProject,
  queueUploads,
  pendingUploads,
  discardUpload,
  type StoredImage,
} from "./storage";
import { demos, demoDocument, demoUrls, createDemo } from "./demos";
import { processImage } from "./images";
import {
  archiveBlob,
  download,
  filename,
  importArchive,
  kitBlob,
  pngBlob,
} from "./exports";
import { Library } from "./Library";
import { Editor } from "./Editor";
import { Kit } from "./Kit";
import { copy } from "./copy";
const getRoute = () => location.hash.slice(1).split("/").filter(Boolean);
export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [projects, setProjects] = useState<BoardDocument[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<
    "projects" | "new" | "export" | "storage" | null
  >(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [presentation, setPresentation] = useState(false);
  const [drag, setDrag] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    archive = useRef<HTMLInputElement>(null);
  const current = useRef<ProjectSession | null>(null);
  const operation = useRef(false);
  const navigation = useRef(0);
  useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    session?.snapshot ?? (() => 0),
  );
  const id = route[0] === "project" ? route[1] : undefined;
  const view = route[2] ?? "library";
  const refresh = useCallback(() => {
    void listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const change = () => {
      const next = getRoute();
      const token = ++navigation.current;
      void (async () => {
        const active = current.current;
        try {
          await active?.prepareDeparture();
          if (token !== navigation.current) return;
          if (active && next[1] !== active.doc.id) active.close();
          else active?.cancelDeparture();
          setRoute(next);
          setPresentation(false);
        } catch {
          if (token !== navigation.current) return;
          active?.cancelDeparture();
          history.replaceState(
            null,
            "",
            `#/project/${current.current?.doc.id}/board`,
          );
          setError(
            "Не удалось сохранить. Коллекция остаётся открытой: повторите сохранение или скачайте архив.",
          );
        }
      })();
    };
    window.addEventListener("hashchange", change);
    refresh();
    return () => window.removeEventListener("hashchange", change);
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    let opened: ProjectSession | undefined;
    setSession(null);
    setUrls({});
    if (id)
      void loadProject(id)
        .then((doc) => {
          if (cancelled) return;
          opened = new ProjectSession(doc);
          current.current = opened;
          setSession(opened);
          const active = opened;
          void active.ready
            .then(async () => {
              if (cancelled || active.readOnly) return;
              await active.upload(async () =>
                processUploads(active, await pendingUploads(active.doc.id)),
              );
            })
            .catch((e) => {
              if (!cancelled) setError(e.message);
            });
        })
        .catch((e) => setError(e.message));
    else current.current = null;
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [id]);
  const materialKey = session?.doc.materials
    .map((m) => m.id + ":" + m.blobId)
    .join("|");
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const created: string[] = [];
    void Promise.all(
      session.doc.materials
        .filter((m) => m.type === "image" && m.blobId)
        .map(async (m) => {
          const image = await session.image(m.blobId!);
          const url = URL.createObjectURL(image.thumbnail);
          created.push(url);
          return [m.id, url];
        }),
    )
      .then((entries) => {
        if (!cancelled) setUrls(Object.fromEntries(entries));
        else created.forEach(URL.revokeObjectURL);
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      created.forEach(URL.revokeObjectURL);
    };
  }, [session, materialKey]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (current.current?.unsettled) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden")
        void current.current?.flush().catch(() => {
          /* Session retains the error and recovery state. */
        });
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresentation(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const navigate = async (path: string) => {
    const token = ++navigation.current;
    const active = current.current;
    try {
      await active?.prepareDeparture();
      if (token !== navigation.current) return;
      if (active && path.split("/")[2] !== active.doc.id) active.close();
      else active?.cancelDeparture();
      location.hash = path;
      setModal(null);
      setError("");
      refresh();
    } catch {
      if (token !== navigation.current) return;
      active?.cancelDeparture();
      setError(
        "Сначала сохраните изменения или экспортируйте резервный архив. Текущая коллекция остаётся открытой.",
      );
    }
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    if (operation.current) {
      setError("Дождитесь завершения текущей операции и повторите действие.");
      return;
    }
    setBusy(label);
    operation.current = true;
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие.",
      );
    } finally {
      setBusy("");
      operation.current = false;
    }
  };
  const openDemo = (index: number) =>
    void run("Готовим локальную копию…", async () => {
      const doc = await createDemo(index);
      await navigate(`/project/${doc.id}/board`);
    });
  const addMaterial = (m: Material) => {
    if (!session) return false;
    return session.command((d) => {
      const n = d.objects.length % 12;
      d.objects.push(
        clampObject(
          {
            id: uid(),
            type: m.type === "image" ? "image" : "note",
            title: m.title,
            x: 80 + n * 24,
            y: 80 + n * 24,
            width: 360,
            height:
              m.type === "image"
                ? Math.min(480, (360 * (m.height ?? 1)) / (m.width ?? 1))
                : 260,
            ...(m.type === "image"
              ? { assetId: m.id }
              : { text: m.text ?? "", color: "#E1E8D9", fontSize: 28 }),
          },
          d,
        ),
      );
    });
  };
  async function processUploads(active: ProjectSession, batch: StoredImage[]) {
    let count = 0;
    const errors: string[] = [];
    for (const image of batch) {
      const name = image.upload!.name;
      let p;
      try {
        p = await processImage(image.blob);
      } catch (e) {
        await discardUpload(image.id);
        errors.push(`${name}: ${(e as Error).message}`);
        continue;
      }
      const blobId = image.id;
      const m: Material = {
        id: uid(),
        type: "image",
        title: name.replace(/\.[^.]+$/, "").slice(0, 120) || "Изображение",
        tags: [],
        favorite: false,
        blobId,
        width: p.width,
        height: p.height,
        colors: p.colors,
      };
      active.pendingImages.set(blobId, {
        id: blobId,
        blob: image.blob,
        thumbnail: p.thumbnail,
      });
      if (active.command((d) => d.materials.push(m), true)) count++;
      else {
        active.pendingImages.delete(blobId);
        await discardUpload(blobId);
        errors.push(`${name}: ${active.actionError}`);
      }
    }
    if (count) {
      await active.flush();
      setToast(`Добавлено изображений: ${count}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
  }
  const files = (list: FileList | File[]) => {
    if (!session || session.readOnly) return;
    const batch = Array.from(list);
    void run("Обрабатываем изображения на устройстве…", () =>
      session.upload(async () => {
        if (session.doc.materials.length + batch.length > 300)
          throw new Error("В коллекции может быть не больше 300 находок.");
        if (batch.some((file) => file.size > 10 * 1024 * 1024))
          throw new Error("Изображение превышает допустимый размер 10 МиБ.");
        await session.flush();
        const queued = await queueUploads(session.doc, batch);
        await processUploads(session, queued);
      }),
    );
  };
  const exportFile = (kind: "png" | "kit" | "archive") => {
    if (!session) return;
    void run("Собираем экспорт…", async () => {
      const blob = await (kind === "png"
        ? pngBlob(session)
        : kind === "kit"
          ? kitBlob(session.doc)
          : archiveBlob(session));
      download(
        blob,
        `${filename(session.doc.name)}${kind === "png" ? ".png" : kind === "kit" ? "-design-kit.zip" : ".forme"}`,
      );
      setToast("Файл готов и передан браузеру");
    });
  };
  const projectsModal = () => {
    refresh();
    setModal("projects");
  };
  return (
    <div
      className={`app ${id ? "studio" : "landing"} ${presentation ? "presentation-mode" : ""}`}
      onDragOver={(e) => {
        if (id && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        if (id) {
          e.preventDefault();
          setDrag(false);
          files(e.dataTransfer.files);
        }
      }}
    >
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById("main-content");
          main?.focus();
          main?.scrollIntoView({ block: "start" });
        }}
      >
        К содержимому
      </a>
      {!id ? (
        <>
          <header className="landing-header">
            <Brand onClick={() => void navigate("")} />
            <span className="header-note">Для тех, кто замечает.</span>
            <button className="button primary" onClick={projectsModal}>
              Открыть студию
              <ArrowUpRight size={16} />
            </button>
          </header>
          <main id="main-content" tabIndex={-1}>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="tiny-sun">✳</span> ЛИЧНАЯ ВИЗУАЛЬНАЯ СТУДИЯ
                </div>
                <h1>
                  {copy.hero[0]}
                  <br />
                  {copy.hero[1]}
                  <br />
                  {copy.hero[2]} <em>{copy.hero[3]}</em>
                </h1>
                <p>
                  {copy.intro[0]}
                  <br />
                  {copy.intro[1]}
                  <br className="desktop-break" /> {copy.intro[2]}
                </p>
                <button
                  className="button primary hero-cta"
                  onClick={projectsModal}
                >
                  Создать свою коллекцию
                  <ArrowUpRight size={18} />
                </button>
                <div className="hero-footnote">
                  <span className="little-line" />
                  {copy.privacy}
                </div>
              </div>
              <div className="hero-board">
                <div className="hero-board-label">
                  <span>КОЛЛЕКЦИЯ № 001</span>
                  <span>НАЖМИТЕ, ЧТОБЫ ИССЛЕДОВАТЬ ↗</span>
                </div>
                <BoardPreview
                  doc={demoDocument(0)}
                  urls={demoUrls(0)}
                  onClick={() => openDemo(0)}
                />
                <div className="hero-caption">
                  <span>Тихая архитектура</span>
                  <span className="handwriting">Увидеть привычное иначе.</span>
                </div>
                <span className="hero-board-index">01 / 03</span>
              </div>
            </section>
            <section className="process-line" aria-label="Как работает FORME">
              <div>
                <span>01</span>
                <p>
                  Замечайте.<small>Изображения, мысли и ссылки</small>
                </p>
              </div>
              <ArrowRight size={20} />
              <div>
                <span>02</span>
                <p>
                  Соединяйте.<small>Живая композиция на доске</small>
                </p>
              </div>
              <ArrowRight size={20} />
              <div>
                <span>03</span>
                <p>
                  Забирайте с собой.<small>Палитра, шрифты и design kit</small>
                </p>
              </div>
            </section>
            <section className="demo-section">
              <div className="demo-heading">
                <div>
                  <div className="eyebrow">
                    НЕ НУЖНО НАЧИНАТЬ С ЧИСТОГО ЛИСТА
                  </div>
                  <h2>
                    Три настроения.
                    <br />
                    <em>Бесконечно много ваших идей.</em>
                  </h2>
                </div>
                <p>
                  Откройте пример и сделайте его своим.
                  <br />
                  Изменения сохранятся в вашей локальной копии.
                </p>
              </div>
              <div className="demo-grid">
                {demos.map((demo, i) => (
                  <button
                    className="demo-card"
                    key={demo.name}
                    onClick={() => openDemo(i)}
                  >
                    <div className="demo-photo">
                      <img
                        src={`/images/photo-${i * 4 + 1}.jpg`}
                        alt={demo.name}
                      />
                      <span>ДЕМО / 0{i + 1}</span>
                      <span className="demo-arrow">
                        <ArrowUpRight size={24} />
                      </span>
                    </div>
                    <div className="demo-title">
                      <h3>{demo.name}</h3>
                      <div>
                        {demo.colors.slice(0, 4).map((c) => (
                          <i key={c} style={{ background: c }} />
                        ))}
                      </div>
                    </div>
                    <p>{demo.caption}</p>
                  </button>
                ))}
              </div>
            </section>
            <section className="closing-note">
              <span>✳</span>
              <p>
                Не всё нужно объяснять.
                <br />
                <em>Иногда достаточно сохранить.</em>
              </p>
              <button className="text-link" onClick={projectsModal}>
                Найти свою форму
                <ArrowUpRight size={18} />
              </button>
            </section>
          </main>
          <footer className="landing-footer">
            <Brand
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            />
            <span>Личная коллекция. Собственный взгляд.</span>
            <button onClick={() => setModal("storage")}>
              О локальном хранении
            </button>
          </footer>
        </>
      ) : (
        <>
          <header className="studio-header">
            <Brand onClick={() => void navigate("")} />
            <span className="header-divider" />
            <button className="project-switch" onClick={projectsModal}>
              <span>{session?.doc.name ?? "Открываем коллекцию…"}</span>
              <ChevronDown size={15} />
            </button>
            <nav className="studio-nav" aria-label="Разделы коллекции">
              {[
                ["library", "Библиотека"],
                ["board", "Доска"],
                ["kit", "Design kit"],
              ].map(([path, label]) => (
                <button
                  key={path}
                  aria-current={view === path ? "page" : undefined}
                  onClick={() => void navigate(`/project/${id}/${path}`)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="header-actions">
              {session && (
                <>
                  <span
                    className={`save-status ${session.status}`}
                    role="status"
                  >
                    {session.readOnly ? (
                      <>
                        <HardDrive size={13} />
                        Просмотр
                      </>
                    ) : session.status === "saved" && !session.hasDrafts ? (
                      <>
                        <Check size={14} />
                        Сохранено
                      </>
                    ) : session.hasDrafts ||
                      session.status === "pending" ||
                      session.status === "persisting" ? (
                      <>
                        <LoaderCircle size={14} className="spinning" />
                        {session.hasDrafts
                          ? "Ввод не завершён"
                          : session.status === "pending"
                            ? "Обрабатываем…"
                            : "Сохраняем…"}
                      </>
                    ) : (
                      <>
                        <AlertCircle size={14} />
                        Не сохранено
                      </>
                    )}
                  </span>
                  {view === "board" && (
                    <>
                      <IconButton
                        label="Отменить"
                        disabled={
                          !session.history.past.length || session.readOnly
                        }
                        onClick={() => session.undo()}
                      >
                        <Undo2 size={17} />
                      </IconButton>
                      <IconButton
                        label="Повторить"
                        disabled={
                          !session.history.future.length || session.readOnly
                        }
                        onClick={() => session.redo()}
                      >
                        <Redo2 size={17} />
                      </IconButton>
                      <IconButton
                        label={
                          presentation ? "Выйти из презентации" : "Презентация"
                        }
                        onClick={() => setPresentation(!presentation)}
                      >
                        {presentation ? <X size={18} /> : <Monitor size={18} />}
                      </IconButton>
                    </>
                  )}
                  <button
                    aria-label="Экспорт"
                    className="button primary export-top"
                    onClick={() => setModal("export")}
                  >
                    <Download size={16} />
                    <span>Экспорт</span>
                  </button>
                </>
              )}
            </div>
          </header>
          {session?.readOnly && session.lockReady && (
            <div className="notice">
              Коллекция уже открыта для редактирования в другой вкладке. Здесь
              доступен просмотр и экспорт. Закройте ту вкладку и перезагрузите
              эту.
            </div>
          )}
          {session?.actionError && (
            <div className="error-banner" role="alert">
              {session.actionError}
              <button
                className="button"
                onClick={() => session.dismissActionError()}
              >
                Закрыть
              </button>
            </div>
          )}
          {(session?.status === "error" ||
            session?.status === "conflicted") && (
            <div className="error-banner" role="alert">
              <strong>Изменения не сохранены.</strong> {session.error}
              <button
                className="button"
                onClick={() =>
                  void run("Повторяем сохранение…", () => session.flush())
                }
              >
                Повторить
              </button>
              <button className="button" onClick={() => exportFile("archive")}>
                Скачать резервную копию
              </button>
            </div>
          )}
          <div
            id="main-content"
            tabIndex={-1}
            className="studio-content"
            inert={session?.leaving}
          >
            {session ? (
              view === "board" ? (
                <Editor
                  session={session}
                  urls={urls}
                  onUpload={() => upload.current?.click()}
                  onAdd={addMaterial}
                  presentation={presentation}
                />
              ) : view === "kit" ? (
                <Kit session={session} onExport={() => exportFile("kit")} />
              ) : (
                <Library
                  session={session}
                  urls={urls}
                  onUpload={() => upload.current?.click()}
                  onAdd={addMaterial}
                  notify={setToast}
                />
              )
            ) : (
              <div className="loading-state">
                <LoaderCircle className="spinning" />
                Открываем ваше пространство…
              </div>
            )}
          </div>
        </>
      )}
      <input
        ref={upload}
        className="file-input"
        tabIndex={-1}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        aria-label="Загрузить изображения"
        onChange={(e) => {
          if (e.target.files) files(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={archive}
        className="file-input"
        tabIndex={-1}
        type="file"
        accept=".forme,.zip"
        aria-label="Импорт архива FORME"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void run("Восстанавливаем коллекцию…", async () => {
              const doc = await importArchive(file);
              await navigate(`/project/${doc.id}/board`);
              setToast("Коллекция восстановлена вместе с изображениями");
            });
        }}
      />
      {modal === "projects" && (
        <Modal title="Ваше пространство" onClose={() => setModal(null)} wide>
          <p className="muted">
            Коллекции живут в этом браузере. Начните свою или исследуйте пример.
          </p>
          <div className="project-actions">
            <button className="button primary" onClick={() => setModal("new")}>
              <Plus size={17} />
              Новая коллекция
            </button>
            <button className="button" onClick={() => archive.current?.click()}>
              <FolderOpen size={17} />
              Импорт .forme
            </button>
          </div>
          {projects.length > 0 && (
            <div className="project-list">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void navigate(`/project/${p.id}/library`)}
                >
                  <span
                    className="project-monogram"
                    style={{
                      background: p.kit.colors.background,
                      color: p.kit.colors.text,
                    }}
                  >
                    {p.name[0]}
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.materials.length} находок · {p.objects.length} объектов{" "}
                      {p.demo ? "· демо-копия" : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={20} />
                </button>
              ))}
            </div>
          )}
          <h3 className="modal-subheading">Начать с настроения</h3>
          <div className="project-demos">
            {demos.map((d, i) => (
              <button key={d.name} onClick={() => openDemo(i)}>
                <img src={`/images/photo-${i * 4 + 1}.jpg`} alt="" />
                <span>
                  <small>ДЕМО / 0{i + 1}</small>
                  {d.name}
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
          <button
            className="text-link storage-link"
            onClick={() => setModal("storage")}
          >
            Как хранится моя работа?
          </button>
        </Modal>
      )}
      {modal === "new" && (
        <Modal title="Начало новой идеи" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(
                new FormData(e.currentTarget).get("name"),
              ).trim();
              void run("Создаём коллекцию…", async () => {
                const d = blankProject(name);
                d.revision = await writeProject(d, 0);
                await navigate(`/project/${d.id}/library`);
              });
            }}
          >
            <label className="field">
              Название коллекции
              <input
                autoFocus
                name="name"
                required
                maxLength={120}
                placeholder="Например, Дом у моря"
              />
            </label>
            <p className="muted">Первый шаг — заметить. Остальное сложится.</p>
            <button className="button primary" type="submit">
              Создать коллекцию
              <ArrowUpRight size={17} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "export" && (
        <Modal title="Заберите идею с собой" onClose={() => setModal(null)}>
          <p className="muted">Из вашего пространства — в следующий проект.</p>
          <div className="export-options">
            <button disabled={!!busy} onClick={() => exportFile("png")}>
              <Image size={25} />
              <span>
                <strong>Мудборд в PNG</strong>
                <small>
                  {session?.doc.width} × {session?.doc.height} px · изображения
                  и заметки
                </small>
              </span>
              <Download size={18} />
            </button>
            <button disabled={!!busy} onClick={() => exportFile("kit")}>
              <Palette size={25} />
              <span>
                <strong>Design kit</strong>
                <small>tokens.json, theme.css и DESIGN.md</small>
              </span>
              <Download size={18} />
            </button>
            <button disabled={!!busy} onClick={() => exportFile("archive")}>
              <FileArchive size={25} />
              <span>
                <strong>Полный архив .forme</strong>
                <small>Редактируемая доска и все исходные изображения</small>
              </span>
              <Download size={18} />
            </button>
          </div>
          <p className="export-note">
            Архив — ваша резервная копия. Его можно восстановить в другом
            браузере через «Импорт .forme».
          </p>
        </Modal>
      )}
      {modal === "storage" && (
        <Modal
          title="Ваши находки остаются вашими"
          onClose={() => setModal(null)}
        >
          <div className="storage-info">
            <HardDrive size={32} />
            <p>
              FORME сохраняет изображения и коллекции в хранилище этого
              браузера. Пользовательские файлы не отправляются на сервер.
            </p>
            <p>
              Очистка данных браузера, приватный режим и удаление профиля могут
              привести к потере работы. Это локальное хранение, а не облачная
              синхронизация.
            </p>
            <p>
              Регулярно скачивайте полный архив .forme. Он содержит и доску, и
              изображения — всё для восстановления на другом устройстве.
            </p>
            <small>
              JPEG, PNG, WebP · до 10 МиБ и 40 Мп на изображение · архив до 200
              МиБ данных · до 300 находок и 500 объектов.
            </small>
          </div>
        </Modal>
      )}
      {error && (
        <div className="global-error" role="alert">
          <AlertCircle size={20} />
          <p>{error}</p>
          <IconButton
            label="Закрыть сообщение об ошибке"
            onClick={() => setError("")}
          >
            <X size={18} />
          </IconButton>
        </div>
      )}
      {busy && (
        <div className="busy-status" role="status">
          <LoaderCircle className="spinning" size={17} />
          {busy}
        </div>
      )}
      {toast && !error && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {drag && (
        <div className="drop-overlay">
          <Upload size={42} />
          <h2>Оставьте находки здесь</h2>
          <p>JPEG, PNG или WebP · до 10 МиБ</p>
        </div>
      )}
    </div>
  );
}
