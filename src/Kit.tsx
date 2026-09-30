import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, AlertCircle, Download } from "lucide-react";
import {
  contrast,
  fontPairs,
  hexValid,
  roleNames,
  roles,
  type Role,
} from "./model";
import type { ProjectSession } from "./storage";
export function ColorField({
  value,
  onChange,
  label,
  disabled = false,
  session,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  session: ProjectSession;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const token = useRef({});
  const input = useRef<HTMLInputElement>(null);
  const canonical = useRef(value);
  canonical.current = value;
  useEffect(() => {
    if (document.activeElement !== input.current) {
      setDraft(value);
      setInvalid(false);
      session.setDraft(token.current, null);
    }
  }, [value, session]);
  useEffect(() => {
    const key = token.current;
    return () => session.setDraft(key, null);
  }, [session]);
  return (
    <div className="color-field">
      <input
        type="color"
        aria-label={`Выбрать цвет: ${label}`}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
          session.setDraft(token.current, null);
          onChange(e.target.value);
        }}
      />
      <input
        ref={input}
        aria-label={`HEX: ${label}`}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        spellCheck={false}
        autoComplete="off"
        value={draft}
        disabled={disabled}
        maxLength={7}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (hexValid(next)) {
            setInvalid(false);
            onChange(next);
            session.setDraft(token.current, null);
          } else
            session.setDraft(token.current, () => {
              setDraft(canonical.current);
              setInvalid(false);
              session.setDraft(token.current, null);
            });
        }}
        onBlur={() => {
          if (hexValid(draft)) {
            setInvalid(false);
            onChange(draft);
          } else setInvalid(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {invalid && (
        <span id={errorId} role="alert" className="error-text">
          Введите цвет вида #A1B2C3
        </span>
      )}
    </div>
  );
}
export function Kit({
  session,
  onExport,
}: {
  session: ProjectSession;
  onExport: () => void;
}) {
  const d = session.doc;
  const colors = d.kit.colors;
  const [source, setSource] = useState(
    d.materials.find((m) => m.type === "image")?.id ?? "all",
  );
  const [role, setRole] = useState<Role>("accent");
  const [mobilePreview, setMobilePreview] = useState(false);
  const images = d.materials.filter((m) => m.type === "image");
  const palette = [
    ...new Set(
      images
        .filter((m) => source === "all" || m.id === source)
        .flatMap((m) => m.colors),
    ),
  ].slice(0, 24);
  const font = fontPairs[d.kit.fontPair];
  const change = (r: Role, v: string) =>
    session.command((p) => {
      p.kit.colors[r] = v;
    });
  const pairs: [string, string, string][] = [
    ["Основной текст", colors.text, colors.background],
    ["Подписи", colors.muted, colors.background],
    ["Текст на карточке", colors.text, colors.surface],
    ["Текст кнопки", colors.surface, colors.accent],
  ];
  return (
    <main className="kit page-content">
      <div className="page-intro">
        <div>
          <div className="eyebrow">ОТ НАХОДОК К ВИЗУАЛЬНОМУ ЯЗЫКУ</div>
          <h1>
            У идеи появляется <em>характер.</em>
          </h1>
          <p>Цвета, типографика и готовая основа для следующего проекта.</p>
        </div>
        <button className="button primary" onClick={onExport}>
          <Download size={17} />
          Экспорт design kit
        </button>
      </div>
      <div className="mobile-kit-tabs">
        <button
          aria-pressed={!mobilePreview}
          onClick={() => setMobilePreview(false)}
        >
          Настроить
        </button>
        <button
          aria-pressed={mobilePreview}
          onClick={() => setMobilePreview(true)}
        >
          Превью и контраст
        </button>
      </div>
      <div
        className={`kit-layout ${mobilePreview ? "show-preview" : "show-settings"}`}
      >
        <div className="kit-settings">
          <section className="kit-section">
            <div className="section-heading">
              <h2>
                <span>01</span>Цвета из находок
              </h2>
              <span className="mini-label">ЛОКАЛЬНО</span>
            </div>
            <label className="field">
              Источник
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="all">Все изображения коллекции</option>
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              Применить к
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {roles.map((r) => (
                  <option value={r} key={r}>
                    {roleNames[r]}
                  </option>
                ))}
              </select>
            </label>
            <div className="palette-strip">
              {palette.map((c) => (
                <button
                  key={c}
                  disabled={session.readOnly}
                  aria-pressed={c.toLowerCase() === colors[role].toLowerCase()}
                  style={{
                    background: c,
                    color:
                      contrast(c, "#000000") >= contrast(c, "#ffffff")
                        ? "#000000"
                        : "#ffffff",
                  }}
                  aria-label={`Назначить ${c} роли ${roleNames[role]}`}
                  title={`Назначить роли «${roleNames[role]}»`}
                  onClick={() => change(role, c)}
                >
                  {c.toLowerCase() === colors[role].toLowerCase() && (
                    <Check size={17} />
                  )}
                  <span>{c}</span>
                </button>
              ))}
            </div>
            {!palette.length && (
              <p className="muted">
                Добавьте изображение в библиотеку, чтобы извлечь его цвета.
              </p>
            )}
            <small className="muted">
              Нажмите на цвет, чтобы назначить роль. Для одноцветных изображений
              оттенков может быть меньше.
            </small>
          </section>
          <section className="kit-section">
            <div className="section-heading">
              <h2>
                <span>02</span>Роли в интерфейсе
              </h2>
            </div>
            {roles.map((r) => {
              const ratio = contrast(
                colors[r],
                r === "accent" ? colors.surface : colors.background,
              );
              return (
                <div className="role-row" key={r}>
                  <label>
                    {roleNames[r]}
                    <small>--{r}</small>
                    {["text", "muted", "accent"].includes(r) && (
                      <small
                        className={ratio < 4.5 ? "error-text" : "contrast-pass"}
                      >
                        {ratio.toFixed(2)}:1{" "}
                        {ratio < 4.5 ? "· Усильте контраст" : "· Достаточно"}
                      </small>
                    )}
                  </label>
                  <ColorField
                    session={session}
                    value={colors[r]}
                    label={roleNames[r]}
                    disabled={session.readOnly}
                    onChange={(v) => change(r, v)}
                  />
                </div>
              );
            })}
          </section>
          <section className="kit-section">
            <div className="section-heading">
              <h2>
                <span>03</span>Типографика
              </h2>
            </div>
            <div className="font-options">
              {fontPairs.map((p, i) => (
                <button
                  disabled={session.readOnly}
                  aria-pressed={d.kit.fontPair === i}
                  className={d.kit.fontPair === i ? "active" : ""}
                  key={p.name}
                  onClick={() =>
                    session.command((doc) => {
                      doc.kit.fontPair = i as 0 | 1 | 2;
                    })
                  }
                >
                  <span style={{ fontFamily: p.heading }}>Aa</span>
                  <div>
                    {p.name}
                    <small>
                      {p.heading} + {p.body}
                    </small>
                  </div>
                  {d.kit.fontPair === i && <Check size={16} />}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="kit-preview-column">
          <div className="preview-label">
            <span>ЖИВОЕ ПРЕВЬЮ</span>
            <span>Ваши цвета. Ваше настроение.</span>
          </div>
          <div
            className="kit-live-preview"
            style={{
              background: colors.background,
              color: colors.text,
              fontFamily: font.body,
            }}
          >
            <div className="sample-nav">
              <span>studio / 01</span>
              <ArrowUpRight size={20} />
            </div>
            <span className="sample-eyebrow" style={{ color: colors.muted }}>
              МАЛЕНЬКИЕ ДЕТАЛИ. БОЛЬШОЙ СМЫСЛ.
            </span>
            <h2 style={{ fontFamily: font.heading }}>
              Красота
              <br />в простых
              <br />
              <em>вещах.</em>
            </h2>
            <p style={{ color: colors.muted }}>
              Место, где фактуры встречаются со светом, а случайные находки
              становятся вашей историей.
            </p>
            <a
              className="sample-button"
              href="#sample-story"
              style={{ background: colors.accent, color: colors.surface }}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("sample-story")?.scrollIntoView({
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "auto"
                    : "smooth",
                  block: "nearest",
                });
              }}
            >
              Увидеть историю
              <ArrowUpRight size={16} />
            </a>
            <article id="sample-story" style={{ background: colors.surface }}>
              <div
                className="sample-arch"
                style={{ background: colors.accent }}
              />
              <div>
                <span style={{ color: colors.muted }}>ЗАМЕТКИ НА ПОЛЯХ</span>
                <h3 style={{ fontFamily: font.heading }}>
                  Оставить место
                  <br />
                  для воздуха.
                </h3>
                <p>Хорошая идея не требует лишнего.</p>
              </div>
            </article>
          </div>
          <section className="contrast-panel">
            <h3>
              Проверка контраста <span>WCAG · обычный текст 4.5:1</span>
            </h3>
            {pairs.map(([label, a, b]) => {
              const ratio = contrast(a, b);
              return (
                <div
                  className={
                    ratio >= 4.5 ? "contrast-pass" : "contrast-warning"
                  }
                  key={label}
                >
                  <span>
                    {ratio >= 4.5 ? (
                      <Check size={15} />
                    ) : (
                      <AlertCircle size={15} />
                    )}{" "}
                    {label}
                  </span>
                  <strong>{ratio.toFixed(2)}:1</strong>
                  <small>
                    {ratio >= 4.5 ? "Достаточно" : "Нужна корректировка"}
                  </small>
                </div>
              );
            })}
            <p>
              Это проверка цветовых пар, а не оценка доступности всего
              интерфейса.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
