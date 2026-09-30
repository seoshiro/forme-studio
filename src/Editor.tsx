import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Plus,
  StickyNote,
  Palette,
  Layers,
  SlidersHorizontal,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import { Board } from "./Board";
import { clampObject, uid, type BoardObject, type Material } from "./model";
import { ColorField } from "./Kit";
import { IconButton } from "./components";
import type { ProjectSession } from "./storage";
export function CommitField({
  label,
  value,
  onCommit,
  type = "text",
  min,
  max,
  session,
}: {
  label: string;
  value: string | number;
  onCommit: (v: string) => string | number;
  session: ProjectSession;
  type?: string;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const token = useRef({});
  const input = useRef<HTMLInputElement>(null);
  const canonical = useRef(String(value));
  canonical.current = String(value);
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(String(value));
  }, [value]);
  useEffect(() => {
    const key = token.current;
    return () => session.setDraft(key, null);
  }, [session]);
  const finish = () => {
    setDraft(canonical.current);
    session.setDraft(token.current, null);
  };
  return (
    <label className="field">
      {label}
      <input
        ref={input}
        type={type}
        value={draft}
        min={min}
        max={max}
        maxLength={type === "text" ? 120 : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (
            type !== "number" ||
            (next !== "" && Number.isFinite(Number(next)))
          )
            canonical.current = String(onCommit(next));
          session.setDraft(
            token.current,
            next === canonical.current ? null : finish,
          );
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function Editor({
  session,
  urls,
  onUpload,
  onAdd,
  presentation,
}: {
  session: ProjectSession;
  urls: Record<string, string>;
  onUpload: () => void;
  onAdd: (m: Material) => void;
  presentation: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<
    "materials" | "layers" | "properties" | null
  >("materials");
  const [hidePanels, setHidePanels] = useState(false);
  const editor = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelInteraction = useRef(0);
  const focusPanel = useRef(false);
  const mobile = () => matchMedia("(max-width: 800px)").matches;
  const openPanel = (
    next: typeof panel,
    keyboard = false,
    origin?: HTMLElement,
  ) => {
    panelInteraction.current++;
    if (mobile()) {
      setHidePanels(false);
      returnFocus.current =
        origin ?? (keyboard ? (document.activeElement as HTMLElement) : null);
      focusPanel.current = keyboard;
    }
    setPanel(next);
  };
  const closePanel = () => {
    const interaction = ++panelInteraction.current;
    setPanel(null);
    requestAnimationFrame(() => {
      if (interaction !== panelInteraction.current) return;
      const origin = returnFocus.current;
      if (origin?.isConnected && origin.getClientRects().length)
        origin.focus({ preventScroll: true });
      else
        editor.current
          ?.querySelector<HTMLButtonElement>(
            `.mobile-editor-tabs button[data-panel="${panel}"]`,
          )
          ?.focus();
    });
  };
  useEffect(() => {
    if (!focusPanel.current || !panel || !mobile()) return;
    focusPanel.current = false;
    const heading = editor.current?.querySelector<HTMLElement>(
      panel === "properties" ? ".properties-heading" : ".sidebar-tabs",
    );
    if (heading?.parentElement) heading.parentElement.scrollTop = 0;
    heading?.focus({ preventScroll: true });
  });
  const doc = session.doc;
  const object = doc.objects.find((o) => o.id === selected);
  const update = (o: BoardObject) =>
    session.command((d) => {
      const i = d.objects.findIndex((a) => a.id === o.id);
      if (i >= 0) d.objects[i] = clampObject(o, d);
    });
  const focusObject = (id: string | null) => {
    const interaction = ++panelInteraction.current;
    requestAnimationFrame(() => {
      if (interaction !== panelInteraction.current) return;
      const target = id
        ? editor.current?.querySelector<HTMLElement>(
            `.board-scene [data-object-id="${CSS.escape(id)}"]`,
          )
        : editor.current?.querySelector<HTMLElement>(".board-viewport");
      target?.focus({ preventScroll: true });
    });
  };
  const remove = (target = object) => {
    if (!target) return;
    const index = doc.objects.findIndex((o) => o.id === target.id);
    const remaining = doc.objects.filter((o) => o.id !== target.id);
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (
      session.command((d) => {
        d.objects = d.objects.filter((o) => o.id !== target.id);
      })
    ) {
      setSelected(next?.id ?? null);
      focusObject(next?.id ?? null);
    }
  };
  const duplicate = (target = object, keyboard = false) => {
    if (!target) return;
    const next = clampObject(
      {
        ...target,
        id: uid(),
        x: target.x + 24,
        y: target.y + 24,
        title: (target.title + " · копия").slice(0, 120),
      },
      doc,
    );
    if (session.command((d) => d.objects.push(next))) {
      setSelected(next.id);
      if (keyboard) focusObject(next.id);
    }
  };
  const layer = (direction: number) =>
    session.command((d) => {
      const index = d.objects.findIndex((o) => o.id === selected),
        next = index + direction;
      if (index < 0 || next < 0 || next >= d.objects.length) return;
      [d.objects[index], d.objects[next]] = [d.objects[next], d.objects[index]];
    });
  const add = (type: "note" | "swatch", keyboard = false) => {
    const o: BoardObject = {
      id: uid(),
      type,
      title: type === "note" ? "Мысль на полях" : "Цветовой образец",
      x: 80,
      y: 80,
      width: type === "note" ? 360 : 180,
      height: type === "note" ? 260 : 180,
      color: type === "note" ? "#E1E8D9" : doc.kit.colors.accent,
      ...(type === "note"
        ? { text: "Оставить место\nдля неожиданного.", fontSize: 28 }
        : {}),
    };
    if (!session.command((d) => d.objects.push(o))) return;
    setSelected(o.id);
    openPanel("properties", keyboard);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.defaultPrevented || e.isComposing || target.closest("dialog"))
        return;
      if (e.key === "Escape" && mobile() && panel) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (
        target.closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        ) ||
        presentation ||
        session.readOnly
      )
        return;
      const focused = target.closest<HTMLElement>(".scene-object");
      const activeObject = focused
        ? doc.objects.find((o) => o.id === focused.dataset.objectId)
        : object;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) session.redo();
        else session.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        session.redo();
      } else if (mod && e.key.toLowerCase() === "d" && activeObject) {
        e.preventDefault();
        duplicate(activeObject, Boolean(focused));
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        activeObject
      ) {
        e.preventDefault();
        remove(activeObject);
      } else if (e.key === "Escape") setSelected(null);
      else if (
        activeObject &&
        (focused ||
          target === document.body ||
          target.matches(".board-viewport")) &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        setSelected(activeObject.id);
        const step = e.shiftKey ? 10 : 1;
        update({
          ...activeObject,
          x:
            activeObject.x +
            (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
          y:
            activeObject.y +
            (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const select = (id: string | null, keyboard = false) => {
    setSelected(id);
    if (id) openPanel("properties", keyboard);
  };
  return (
    <main
      ref={editor}
      onFocusCapture={(e) => {
        if (
          mobile() &&
          panel &&
          (e.target as HTMLElement).closest(".board-workspace")
        )
          setPanel(null);
      }}
      className={`editor ${presentation ? "presentation" : ""} ${hidePanels ? "hide-panels" : ""}`}
    >
      {!presentation && (
        <button
          className="panel-toggle"
          aria-pressed={hidePanels}
          onClick={() => setHidePanels(!hidePanels)}
        >
          {hidePanels ? "Показать панели" : "Скрыть панели"}
        </button>
      )}
      {!presentation && (
        <aside
          className={`editor-sidebar ${panel === "materials" || panel === "layers" ? "mobile-open" : ""}`}
        >
          <div className="sidebar-tabs" tabIndex={-1}>
            <button
              aria-pressed={panel !== "layers"}
              className={panel !== "layers" ? "active" : ""}
              onClick={(e) => openPanel("materials", e.detail === 0)}
            >
              Материалы <span>{doc.materials.length}</span>
            </button>
            <button
              aria-pressed={panel === "layers"}
              className={panel === "layers" ? "active" : ""}
              onClick={(e) => openPanel("layers", e.detail === 0)}
            >
              Слои <span>{doc.objects.length}</span>
            </button>
            <IconButton
              className="mobile-only"
              label="Закрыть материалы"
              onClick={closePanel}
            >
              <X size={16} />
            </IconButton>
          </div>
          {panel === "layers" ? (
            <div className="object-list" aria-label="Список объектов">
              {[...doc.objects].reverse().map((o) => (
                <button
                  aria-pressed={selected === o.id}
                  className={selected === o.id ? "active" : ""}
                  key={o.id}
                  onClick={(e) => select(o.id, e.detail === 0)}
                >
                  {o.type === "image" ? (
                    <img src={urls[o.assetId!]} alt="" />
                  ) : (
                    <span style={{ background: o.color }}>
                      {o.type === "note" ? "T" : ""}
                    </span>
                  )}
                  <span>{o.title}</span>
                </button>
              ))}
              {!doc.objects.length && (
                <p className="muted">Добавленные объекты появятся здесь.</p>
              )}
            </div>
          ) : (
            <>
              <div className="add-tools">
                <button onClick={onUpload} disabled={session.readOnly}>
                  <ImagePlus size={18} />
                  <span>Загрузить</span>
                </button>
                <button
                  onClick={(e) => add("note", e.detail === 0)}
                  disabled={session.readOnly}
                >
                  <StickyNote size={18} />
                  <span>Заметка</span>
                </button>
                <button
                  onClick={(e) => add("swatch", e.detail === 0)}
                  disabled={session.readOnly}
                >
                  <Palette size={18} />
                  <span>Цвет</span>
                </button>
              </div>
              <p className="sidebar-hint">
                Нажмите на находку,
                <br />
                чтобы добавить её на доску.
              </p>
              <div className="editor-materials">
                {doc.materials
                  .filter((m) => m.type !== "link")
                  .map((m) => (
                    <button
                      key={m.id}
                      aria-label={`Добавить на доску: ${m.title}`}
                      disabled={session.readOnly}
                      onClick={() => onAdd(m)}
                    >
                      {m.type === "image" ? (
                        <img src={urls[m.id]} alt={m.title} />
                      ) : (
                        <span>{m.text}</span>
                      )}
                      <span className="add-material-overlay">
                        <Plus size={18} />
                      </span>
                    </button>
                  ))}
              </div>
              {!doc.materials.length && (
                <p className="muted sidebar-hint">
                  Пока пусто. Начните с любимого изображения.
                </p>
              )}
            </>
          )}
          <div className="sidebar-footer">F / ВАШЕ ПРОСТРАНСТВО ДЛЯ ИДЕЙ</div>
        </aside>
      )}
      <Board
        doc={doc}
        urls={urls}
        selected={selected}
        onSelect={select}
        onCommit={update}
        readOnly={session.readOnly || presentation}
        presentation={presentation}
      />
      {!presentation && (
        <aside
          className={`properties ${panel === "properties" ? "mobile-open" : ""}`}
        >
          <div className="properties-heading" tabIndex={-1}>
            <h2>{object ? "Свойства объекта" : "Доска"}</h2>
            <IconButton
              className="mobile-only"
              label="Закрыть свойства"
              onClick={closePanel}
            >
              <X size={17} />
            </IconButton>
          </div>
          <fieldset disabled={session.readOnly}>
            {object ? (
              <>
                <div className="object-type-label">
                  {object.type === "image"
                    ? "ИЗОБРАЖЕНИЕ"
                    : object.type === "note"
                      ? "ЗАМЕТКА"
                      : "ЦВЕТОВОЙ ОБРАЗЕЦ"}
                </div>
                <CommitField
                  key={object.id}
                  session={session}
                  label="Название объекта"
                  value={object.title}
                  onCommit={(v) => {
                    update({ ...object, title: v || "Без названия" });
                    return session.doc.objects.find((o) => o.id === object.id)!
                      .title;
                  }}
                />
                <div className="property-grid">
                  {(["x", "y", "width", "height"] as const).map((k) => (
                    <CommitField
                      session={session}
                      key={object.id + k}
                      label={
                        { x: "X", y: "Y", width: "Ширина", height: "Высота" }[k]
                      }
                      value={Math.round(object[k])}
                      type="number"
                      min={k === "x" || k === "y" ? 0 : 24}
                      max={4000}
                      onCommit={(v) => {
                        const n = Number(v);
                        if (Number.isFinite(n)) update({ ...object, [k]: n });
                        return session.doc.objects.find(
                          (o) => o.id === object.id,
                        )![k];
                      }}
                    />
                  ))}
                </div>
                {object.type === "note" && (
                  <>
                    <label className="field">
                      Текст заметки
                      <textarea
                        aria-label="Текст заметки"
                        name="note-text"
                        key={object.id}
                        value={object.text}
                        rows={5}
                        maxLength={3000}
                        onChange={(e) => {
                          if (e.target.value !== object.text)
                            update({ ...object, text: e.target.value });
                        }}
                      />
                    </label>
                    <CommitField
                      session={session}
                      label="Размер текста"
                      value={object.fontSize ?? 28}
                      type="number"
                      min={12}
                      max={100}
                      onCommit={(v) => {
                        update({
                          ...object,
                          fontSize: Math.max(
                            12,
                            Math.min(100, Number(v) || 28),
                          ),
                        });
                        return (
                          session.doc.objects.find((o) => o.id === object.id)!
                            .fontSize ?? 28
                        );
                      }}
                    />
                  </>
                )}
                {object.type !== "image" && (
                  <label className="field">
                    Цвет
                    <ColorField
                      key={object.id}
                      session={session}
                      label="Объект"
                      value={object.color!}
                      onChange={(v) => update({ ...object, color: v })}
                    />
                  </label>
                )}
                <div className="property-section">
                  <h3>Порядок слоёв</h3>
                  <div className="property-actions">
                    <button
                      className="button"
                      onClick={() => layer(1)}
                      disabled={doc.objects.at(-1)?.id === object.id}
                    >
                      <ArrowUp size={15} />
                      Выше
                    </button>
                    <button
                      className="button"
                      onClick={() => layer(-1)}
                      disabled={doc.objects[0]?.id === object.id}
                    >
                      <ArrowDown size={15} />
                      Ниже
                    </button>
                  </div>
                </div>
                <button className="button full" onClick={() => duplicate()}>
                  <Copy size={16} />
                  Дублировать
                </button>
                <button
                  className="button full subtle-danger"
                  onClick={() => remove()}
                >
                  <Trash2 size={16} />
                  Удалить объект
                </button>
                <small className="keyboard-hint">
                  Стрелки — сдвиг · Shift — 10 px
                  <br />
                  Ctrl/⌘ D — копия · Delete — удалить
                </small>
              </>
            ) : (
              <>
                <p className="muted">
                  Выберите объект на доске или в списке слоёв.
                </p>
                <CommitField
                  session={session}
                  label="Название коллекции"
                  value={doc.name}
                  onCommit={(v) => {
                    session.command((d) => {
                      d.name = v.trim() || "Без названия";
                    });
                    return session.doc.name;
                  }}
                />
                <label className="field">
                  Фон доски
                  <ColorField
                    session={session}
                    label="Фон доски"
                    value={doc.background}
                    onChange={(v) =>
                      session.command((d) => {
                        d.background = v;
                      })
                    }
                  />
                </label>
                <p className="muted">
                  {doc.width} × {doc.height} px
                  <br />
                  {doc.objects.length} объектов
                </p>
                <div className="small-art">
                  f
                  <span>
                    Смысл рождается
                    <br />
                    между находками.
                  </span>
                </div>
              </>
            )}
          </fieldset>
        </aside>
      )}
      {!presentation && (
        <div className="mobile-editor-tabs">
          <button
            data-panel="materials"
            aria-pressed={panel === "materials"}
            onClick={(e) =>
              panel === "materials"
                ? closePanel()
                : openPanel("materials", e.detail === 0, e.currentTarget)
            }
          >
            <ImagePlus size={18} />
            Материалы
          </button>
          <button
            data-panel="layers"
            aria-pressed={panel === "layers"}
            onClick={(e) =>
              panel === "layers"
                ? closePanel()
                : openPanel("layers", e.detail === 0, e.currentTarget)
            }
          >
            <Layers size={18} />
            Слои
          </button>
          <button
            data-panel="properties"
            aria-pressed={panel === "properties"}
            onClick={(e) =>
              panel === "properties"
                ? closePanel()
                : openPanel("properties", e.detail === 0, e.currentTarget)
            }
          >
            <SlidersHorizontal size={18} />
            Свойства
          </button>
        </div>
      )}
    </main>
  );
}
