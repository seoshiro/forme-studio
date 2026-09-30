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
    return <img src={urls[o.assetId!] || ""} alt={o.title} draggable={false} />;
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
  const gesture = useRef<{
    kind: "move" | "resize" | "pan";
    object?: BoardObject;
    startX: number;
    startY: number;
    pan: { x: number; y: number };
    scale: number;
    next?: BoardObject;
  } | null>(null);
  const fit = () => {
    const el = viewport.current;
    if (!el) return;
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
    const observer = new ResizeObserver(() => fit());
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc.id, doc.width, doc.height, presentation]);
  const start = (
    e: ReactPointerEvent,
    object?: BoardObject,
    resize = false,
  ) => {
    if (e.button !== 0) return;
    if (object && !hand) {
      e.stopPropagation();
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
    if (!g) return;
    const dx = (e.clientX - g.startX) / g.scale,
      dy = (e.clientY - g.startY) / g.scale;
    if (g.kind === "pan") {
      setPan({ x: g.pan.x + dx * g.scale, y: g.pan.y + dy * g.scale });
      return;
    }
    const o = { ...g.object! };
    if (g.kind === "resize") {
      o.width += dx;
      o.height += dy;
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
  const end = () => {
    const g = gesture.current;
    if (g?.next && JSON.stringify(g.next) !== JSON.stringify(g.object))
      onCommit(g.next);
    gesture.current = null;
    setPreview(null);
    setGuides({ x: false, y: false });
    setDragging(false);
  };
  return (
    <div className={`board-workspace ${presentation ? "presenting" : ""}`}>
      <div
        ref={viewport}
        className={`board-viewport ${hand ? "hand-mode" : ""} ${dragging ? "dragging" : ""}`}
        aria-label="Рабочая область доски"
        onPointerDown={(e) => start(e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          gesture.current = null;
          setPreview(null);
          setDragging(false);
          setGuides({ x: false, y: false });
        }}
        onWheel={(e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            setScale((s) =>
              Math.max(0.08, Math.min(2, s * (e.deltaY > 0 ? 0.92 : 1.08))),
            );
          }
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
                    onSelect(o.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
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
            onClick={() => setHand(false)}
          >
            <MousePointer2 size={17} />
          </IconButton>
          <IconButton
            label="Перемещение области"
            active={hand}
            onClick={() => setHand(true)}
          >
            <Hand size={17} />
          </IconButton>
        </div>
        <div className="tool-group">
          <IconButton
            label="Уменьшить масштаб"
            onClick={() => setScale((s) => Math.max(0.08, s - 0.1))}
          >
            <Minus size={17} />
          </IconButton>
          <output aria-label="Масштаб">{Math.round(scale * 100)}%</output>
          <IconButton
            label="Увеличить масштаб"
            onClick={() => setScale((s) => Math.min(2, s + 0.1))}
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
