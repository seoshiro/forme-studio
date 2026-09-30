import { useEffect, useId, useRef, useState } from "react";
import {
  Search,
  Plus,
  Heart,
  ArrowUpRight,
  Link2,
  StickyNote,
  ImagePlus,
  SlidersHorizontal,
} from "lucide-react";
import type { Material } from "./model";
import { safeUrl, uid } from "./model";
import type { ProjectSession } from "./storage";
import { Empty, IconButton, Modal } from "./components";
import { copy } from "./copy";
const filters = new Map<
  string,
  { search: string; favorite: boolean; color: string; filter: boolean }
>();
export function MaterialForm({
  material,
  onSave,
  onClose,
}: {
  material?: Material;
  onSave: (m: Material) => boolean;
  onClose: () => void;
}) {
  const [type, setType] = useState(material?.type ?? "note");
  const [title, setTitle] = useState(material?.title ?? "");
  const [body, setBody] = useState(material?.text ?? material?.url ?? "");
  const [tags, setTags] = useState(material?.tags.join(", ") ?? "");
  const [error, setError] = useState("");
  const [urlError, setUrlError] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  return (
    <Modal title={material ? "О находке" : "Новая находка"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const m: Material = {
              ...material,
              id: material?.id ?? uid(),
              type,
              title: title.trim() || "Без названия",
              tags: tags
                .split(",")
                .map((t) => t.trim().slice(0, 40))
                .filter(Boolean)
                .slice(0, 20),
              favorite: material?.favorite ?? false,
              colors: material?.colors ?? [],
            };
            if (type === "link") {
              try {
                m.url = safeUrl(body);
              } catch (err) {
                setError((err as Error).message);
                setUrlError(true);
                urlInput.current?.focus();
                return;
              }
            }
            if (type === "note") m.text = body;
            if (onSave(m)) onClose();
            else
              setError(
                "Изменение не принято. Проверьте ограничения коллекции.",
              );
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {!material && (
          <div className="segmented">
            <button
              type="button"
              aria-pressed={type === "note"}
              className={type === "note" ? "active" : ""}
              onClick={() => {
                setType("note");
                setError("");
                setUrlError(false);
              }}
            >
              <StickyNote size={16} />
              Заметка
            </button>
            <button
              type="button"
              aria-pressed={type === "link"}
              className={type === "link" ? "active" : ""}
              onClick={() => {
                setType("link");
                setError("");
                setUrlError(false);
              }}
            >
              <Link2 size={16} />
              Ссылка
            </button>
          </div>
        )}
        <label className="field">
          Название
          <input
            autoFocus
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Что вас зацепило?"
          />
        </label>
        {type === "note" && (
          <label className="field">
            Текст
            <textarea
              rows={5}
              maxLength={3000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Мысль, которую хочется сохранить…"
            />
          </label>
        )}
        {type === "link" && (
          <label className="field">
            URL
            <input
              type="url"
              ref={urlInput}
              aria-invalid={urlError}
              aria-describedby={urlError ? errorId : undefined}
              required
              maxLength={2000}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setError("");
                setUrlError(false);
              }}
              placeholder="https://"
            />
          </label>
        )}
        <label className="field">
          Теги через запятую
          <input
            maxLength={500}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <small>До 20 тегов, каждый до 40 символов.</small>
        </label>
        {material?.type === "image" && (
          <p className="muted">
            {material.width} × {material.height} px · обработано на устройстве
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="button primary" type="submit">
          Сохранить находку
        </button>
      </form>
    </Modal>
  );
}
export function Library({
  session,
  urls,
  onUpload,
  onAdd,
  notify,
}: {
  session: ProjectSession;
  urls: Record<string, string>;
  onUpload: () => void;
  onAdd: (m: Material) => boolean;
  notify: (s: string) => void;
}) {
  const previous = filters.get(session.doc.id);
  const [search, setSearch] = useState(previous?.search ?? "");
  const [favorite, setFavorite] = useState(previous?.favorite ?? false);
  const [color, setColor] = useState(previous?.color ?? "");
  const [edit, setEdit] = useState<Material | null | undefined>();
  const [filter, setFilter] = useState(previous?.filter ?? false);
  useEffect(() => {
    filters.set(session.doc.id, { search, favorite, color, filter });
  }, [session.doc.id, search, favorite, color, filter]);
  const all = session.doc.materials;
  const swatches = [...new Set(all.flatMap((m) => m.colors.slice(0, 1)))].slice(
    0,
    12,
  );
  const found = all.filter(
    (m) =>
      (!favorite || m.favorite) &&
      (!color || m.colors[0] === color) &&
      `${m.title} ${m.tags.join(" ")} ${m.text ?? ""} ${m.url ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <main className="library page-content">
      <div className="page-intro">
        <div>
          <div className="eyebrow">
            ВАША КОЛЛЕКЦИЯ / {String(all.length).padStart(2, "0")} НАХОДОК
          </div>
          <h1>
            {copy.libraryTitle[0]}
            <br />
            <em>{copy.libraryTitle[1]}</em>
          </h1>
          <p>{copy.libraryDescription}</p>
        </div>
        <div className="intro-actions">
          <button
            className="button"
            disabled={session.readOnly}
            onClick={() => setEdit(null)}
          >
            <Plus size={16} />
            Заметка или ссылка
          </button>
          <button
            className="button primary"
            disabled={session.readOnly}
            onClick={onUpload}
          >
            <ImagePlus size={17} />
            Добавить изображения
          </button>
        </div>
      </div>
      <div className="library-controls">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Поиск по тексту и тегам"
            placeholder="Найти по названию или тегу…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label="Очистить поиск" onClick={() => setSearch("")}>
              ×
            </button>
          )}
        </label>
        <button
          className={`filter-button ${favorite ? "active" : ""}`}
          aria-pressed={favorite}
          onClick={() => setFavorite(!favorite)}
        >
          <Heart size={16} />
          Избранное
        </button>
        <button
          className={`filter-button ${filter ? "active" : ""}`}
          aria-expanded={filter}
          onClick={() => setFilter(!filter)}
        >
          <SlidersHorizontal size={16} />
          Цвет
        </button>
        <span className="result-count">{found.length} находок</span>
      </div>
      {filter && (
        <div className="color-filter">
          <button
            className={!color ? "active" : ""}
            onClick={() => setColor("")}
          >
            Все цвета
          </button>
          {swatches.map((c) => (
            <button
              key={c}
              className={`color-dot ${color === c ? "active" : ""}`}
              style={{ background: c }}
              aria-label={`Фильтр цвета ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(color === c ? "" : c)}
            />
          ))}
          {!swatches.length && (
            <small>Цвета появятся после загрузки изображений.</small>
          )}
        </div>
      )}
      {found.length ? (
        <div className="material-grid">
          {found.map((m, i) => (
            <article className={`material-card ${m.type}`} key={m.id}>
              <button
                className={`material-visual shape-${i % 4}`}
                onClick={() => setEdit(m)}
                aria-label={`Редактировать находку: ${m.title}`}
              >
                {m.type === "image" ? (
                  <img loading="lazy" src={urls[m.id]} alt={m.title} />
                ) : m.type === "note" ? (
                  <>
                    <StickyNote size={18} />
                    <p>{m.text}</p>
                  </>
                ) : (
                  <>
                    <Link2 size={22} />
                    <p>{m.title}</p>
                    <small>{new URL(m.url!).hostname}</small>
                  </>
                )}
              </button>
              <IconButton
                label={
                  m.favorite
                    ? `Убрать из избранного: ${m.title}`
                    : `В избранное: ${m.title}`
                }
                className="favorite-button"
                active={m.favorite}
                disabled={session.readOnly}
                onClick={() =>
                  session.command((d) => {
                    d.materials.find((a) => a.id === m.id)!.favorite =
                      !m.favorite;
                  })
                }
              >
                <Heart size={17} fill={m.favorite ? "currentColor" : "none"} />
              </IconButton>
              <div className="material-caption">
                <div>
                  <h2>{m.title}</h2>
                  <p>
                    {m.tags.length
                      ? m.tags.join(" · ")
                      : m.type === "image"
                        ? "Изображение"
                        : m.type === "note"
                          ? "Заметка"
                          : "Закладка"}
                  </p>
                </div>
                {m.type === "link" ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="icon-button"
                    aria-label={`Открыть ссылку: ${m.title}`}
                  >
                    <ArrowUpRight size={18} />
                  </a>
                ) : (
                  <IconButton
                    label={`На доску: ${m.title}`}
                    disabled={session.readOnly}
                    onClick={() => {
                      if (onAdd(m)) notify("Добавлено на доску");
                    }}
                  >
                    <Plus size={18} />
                  </IconButton>
                )}
              </div>
              {m.type === "image" && (
                <div className="material-colors" aria-label="Извлечённые цвета">
                  {m.colors.map((c) => (
                    <span key={c} style={{ background: c }} title={c} />
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            all.length
              ? "Ничего не нашлось"
              : "У каждой идеи есть первая находка"
          }
          description={
            all.length
              ? "Попробуйте другой запрос или сбросьте фильтры."
              : "Перетащите сюда JPEG, PNG или WebP. До 10 МиБ на файл."
          }
        >
          <button
            className="button primary"
            onClick={
              all.length
                ? () => {
                    setSearch("");
                    setColor("");
                    setFavorite(false);
                  }
                : onUpload
            }
          >
            {all.length ? "Сбросить фильтры" : "Выбрать изображения"}
          </button>
        </Empty>
      )}
      <footer className="page-note">
        <span>Только на вашем устройстве.</span>
        <span>Изображения не отправляются на сервер.</span>
      </footer>
      {edit !== undefined && (
        <MaterialForm
          material={edit ?? undefined}
          onClose={() => setEdit(undefined)}
          onSave={(m) =>
            session.command((d) => {
              const i = d.materials.findIndex((a) => a.id === m.id);
              if (i < 0) d.materials.push(m);
              else d.materials[i] = m;
            })
          }
        />
      )}
    </main>
  );
}
