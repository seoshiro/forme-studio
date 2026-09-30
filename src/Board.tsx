import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Plus, Minus, Maximize, Hand, MousePointer2 } from "lucide-react";
import { clampObject, type BoardDocument, type BoardObject } from "./model";
import { IconButton } from "./components";
export function ObjectVisual({
  object: o,
  urls,
}: {
  object: BoardObject;
  urls: Record<string, string>;
}) {
  if (o.type === "image")
    return <img src={urls[o.assetId!]} alt={o.title} draggable={false} />;
  if (o.type === "swatch")
    return <div className="object-swatch" style={{ background: o.color }} />;
  return (
    <div
      className="object-note"
      style={{ background: o.color, fontSize: o.fontSize ?? 28 }}
    >
      {o.text}
    </div>
  );
}
export function BoardPreview({
  doc,
  urls,
  onClick,
}: {
  doc: BoardDocument;
  urls: Record<string, string>;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / doc.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc.width]);
  const inner = (
    <div
      className="preview-scene"
      style={{
        width: doc.width,
        height: doc.height,
        transform: `scale(${scale})`,
        background: doc.background,
      }}
    >
      {doc.objects.map((o) => (
        <div
          key={o.id}
          className={`scene-object ${o.type}`}
          style={{ left: o.x, top: o.y, width: o.width, height: o.height }}
        >
          <ObjectVisual object={o} urls={urls} />
        </div>
      ))}
    </div>
  );
  return (
    <div
      ref={ref}
      className="board-preview"
      style={{ aspectRatio: `${doc.width}/${doc.height}` }}
    >
      {onClick ? (
        <button
          className="preview-open"
          onClick={onClick}
          aria-label={`Открыть пример «${doc.name}»`}
        >
          {inner}
        </button>
      ) : (
        inner
      )}
    </div>
  );
}
export function Board({
  doc,
  urls,
  selected,
  onSelect,
  onCommit,
  readOnly,
  presentation = false,
}: {
  doc: BoardDocument;
  urls: Record<string, string>;
  selected: string | null;
  onSelect: (id: string | null, keyboard?: boolean) => void;
  onCommit: (o: BoardObject) => void;
  readOnly: boolean;
  presentation?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hand, setHand] = useState(false);
  const [preview, setPreview] = useState<BoardObject | null>(null);
  const [guides, setGuides] = useState({ x: false, y: false });
  const [dragging, setDragging] = useState(false);
  const autoFit = useRef(true);
  const gesture = useRef<{
    kind: "move" | "resize" | "pan";
    pointerId: number;
    capture: Element;
    object?: BoardObject;
    startX: number;
    startY: number;
    pan: { x: number; y: number };
    scale: number;
    moved?: boolean;
    next?: BoardObject;
  } | null>(null);
  const finish = (commit = false) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (commit && g.kind === "pan" && g.moved) autoFit.current = false;
    if (!commit && g.kind === "pan") setPan(g.pan);
    setPreview(null);
    setGuides({ x: false, y: false });
    setDragging(false);
    if (g.capture.hasPointerCapture(g.pointerId))
      g.capture.releasePointerCapture(g.pointerId);
    if (
      commit &&
      !readOnly &&
      g.next &&
      JSON.stringify(g.next) !== JSON.stringify(g.object)
    )
      onCommit(g.next);
  };
  const fit = () => {
    const el = viewport.current;
    if (!el) return;
    finish();
    autoFit.current = true;
    setScale(
      Math.max(
        0.08,
        Math.min(
          (el.clientWidth - 64) / doc.width,
          (el.clientHeight - 64) / doc.height,
          1,
        ),
      ),
    );
    setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    fit();
    const el = viewport.current!;
    const observer = new ResizeObserver(() => {
      if (autoFit.current) fit();
      else finish();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc.id, doc.width, doc.height, presentation]);
  useEffect(() => {
    const cancel = () => finish();
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gesture.current) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("visibilitychange", visibility);
      cancel();
    };
  }, []);
  useEffect(() => {
    const g = gesture.current;
    if (
      g &&
      ((readOnly && g.kind !== "pan") ||
        (g.object &&
          doc.objects.find((o) => o.id === g.object!.id) !== g.object))
    )
      finish();
  }, [doc.objects, readOnly]);
  useEffect(() => {
    const el = viewport.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (gesture.current || e.deltaY === 0) return;
      autoFit.current = false;
      setScale((s) =>
        Math.max(0.08, Math.min(2, s * (e.deltaY > 0 ? 0.92 : 1.08))),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const start = (
    e: ReactPointerEvent,
    object?: BoardObject,
    resize = false,
  ) => {
    if (e.button !== 0 || gesture.current) return;
    e.stopPropagation();
    if (object && !hand) {
      onSelect(object.id);
      if (readOnly) return;
    } else if (!hand && object === undefined) {
      onSelect(null);
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      kind: hand || !object ? "pan" : resize ? "resize" : "move",
      pointerId: e.pointerId,
      capture: e.currentTarget,
      object,
      startX: e.clientX,
      startY: e.clientY,
      pan,
      scale,
    };
    setDragging(true);
  };
  const move = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = (e.clientX - g.startX) / g.scale,
      dy = (e.clientY - g.startY) / g.scale;
    if (g.kind === "pan") {
      g.moved = dx !== 0 || dy !== 0;
      setPan({ x: g.pan.x + dx * g.scale, y: g.pan.y + dy * g.scale });
      return;
    }
    const o = { ...g.object! };
    if (g.kind === "resize") {
      o.width = Math.max(24, Math.min(doc.width - o.x, o.width + dx));
      o.height = Math.max(24, Math.min(doc.height - o.y, o.height + dy));
    } else {
      o.x += dx;
      o.y += dy;
    }
    let gx = false,
      gy = false;
    if (g.kind === "move") {
      o.x = Math.round(o.x / 8) * 8;
      o.y = Math.round(o.y / 8) * 8;
      if (Math.abs(o.x + o.width / 2 - doc.width / 2) < 12) {
        o.x = (doc.width - o.width) / 2;
        gx = true;
      }
      if (Math.abs(o.y + o.height / 2 - doc.height / 2) < 12) {
        o.y = (doc.height - o.height) / 2;
        gy = true;
      }
    }
    g.next = clampObject(o, doc);
    setPreview(g.next);
    setGuides({ x: gx, y: gy });
  };
  return (
    <div className={`board-workspace ${presentation ? "presenting" : ""}`}>
      <div
        ref={viewport}
        className={`board-viewport ${hand ? "hand-mode" : ""} ${dragging ? "dragging" : ""}`}
        tabIndex={-1}
        aria-label="Рабочая область доски"
        onPointerDown={(e) => start(e)}
        onPointerMove={move}
        onPointerUp={(e) => {
          if (e.pointerId === gesture.current?.pointerId) finish(true);
        }}
        onPointerCancel={(e) => {
          if (e.pointerId === gesture.current?.pointerId) finish();
        }}
        onLostPointerCapture={(e) => {
          if (e.pointerId === gesture.current?.pointerId) finish();
        }}
      >
        <div
          className="board-center"
          style={{ transform: `translate(${pan.x}px,${pan.y}px)` }}
        >
          <div
            className="board-scene"
            data-testid="board-scene"
            style={{
              width: doc.width,
              height: doc.height,
              marginLeft: -doc.width / 2,
              marginTop: -doc.height / 2,
              transform: `scale(${scale})`,
              background: doc.background,
            }}
          >
            {doc.objects.map((original) => {
              const o = preview?.id === original.id ? preview : original;
              return (
                <div
                  role="button"
                  tabIndex={presentation ? -1 : 0}
                  aria-label={`Объект: ${o.title}`}
                  aria-pressed={selected === o.id}
                  data-object-id={o.id}
                  key={o.id}
                  className={`scene-object ${o.type} ${!presentation && selected === o.id ? "selected" : ""}`}
                  style={
                    {
                      left: o.x,
                      top: o.y,
                      width: o.width,
                      height: o.height,
                      "--selection-width": `${2 / scale}px`,
                    } as React.CSSProperties
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!hand && !presentation) onSelect(o.id);
                  }}
                  onKeyDown={(e) => {
                    if (!presentation && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelect(o.id, true);
                    }
                  }}
                  onPointerDown={(e) => start(e, o)}
                >
                  <ObjectVisual object={o} urls={urls} />
                  {!presentation && selected === o.id && !readOnly && (
                    <>
                      <span
                        className="object-selection-label"
                        style={{ fontSize: 12 / scale }}
                      >
                        {Math.round(o.width)} × {Math.round(o.height)}
                      </span>
                      <span
                        role="presentation"
                        className="resize-handle"
                        style={{ width: 10 / scale, height: 10 / scale }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          start(e, o, true);
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })}
            {guides.x && <div className="guide vertical" />}
            {guides.y && <div className="guide horizontal" />}
          </div>
        </div>
        {doc.objects.length === 0 && !presentation && (
          <div className="canvas-empty">
            <span>Здесь сложится ваша идея</span>
            <small>
              Добавьте изображение из материалов или создайте заметку.
            </small>
          </div>
        )}
      </div>
      <div className="canvas-toolbar">
        <div className="tool-group">
          <IconButton
            label="Выделение"
            active={!hand}
            onClick={() => {
              finish();
              setHand(false);
            }}
          >
            <MousePointer2 size={17} />
          </IconButton>
          <IconButton
            label="Перемещение области"
            active={hand}
            onClick={() => {
              finish();
              setHand(true);
            }}
          >
            <Hand size={17} />
          </IconButton>
        </div>
        <div className="tool-group">
          <IconButton
            label="Уменьшить масштаб"
            onClick={() => {
              finish();
              autoFit.current = false;
              setScale((s) => Math.max(0.08, s - 0.1));
            }}
          >
            <Minus size={17} />
          </IconButton>
          <output aria-label="Масштаб">{Math.round(scale * 100)}%</output>
          <IconButton
            label="Увеличить масштаб"
            onClick={() => {
              finish();
              autoFit.current = false;
              setScale((s) => Math.min(2, s + 0.1));
            }}
          >
            <Plus size={17} />
          </IconButton>
        </div>
        <IconButton label="Вписать доску" onClick={fit}>
          <Maximize size={17} />
        </IconButton>
      </div>
      <span className="board-dimensions">
        {doc.width} × {doc.height}
      </span>
    </div>
  );
}
