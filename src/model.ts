export type Role = "background" | "surface" | "text" | "muted" | "accent";
export type Material = {
  id: string;
  type: "image" | "note" | "link";
  title: string;
  tags: string[];
  favorite: boolean;
  blobId?: string;
  width?: number;
  height?: number;
  colors: string[];
  text?: string;
  url?: string;
};
export type BoardObject = {
  id: string;
  type: "image" | "note" | "swatch";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  assetId?: string;
  text?: string;
  color?: string;
  fontSize?: number;
};
export type BoardDocument = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  demo: boolean;
  createdAt: number;
  updatedAt: number;
  revision: number;
  width: number;
  height: number;
  background: string;
  materials: Material[];
  objects: BoardObject[];
  kit: { colors: Record<Role, string>; fontPair: 0 | 1 | 2 };
};
export const roles: Role[] = [
  "background",
  "surface",
  "text",
  "muted",
  "accent",
];
export const roleNames: Record<Role, string> = {
  background: "Фон",
  surface: "Поверхность",
  text: "Текст",
  muted: "Подписи",
  accent: "Акцент",
};
export const fontPairs = [
  { name: "Редакционная", heading: "Cormorant Garamond", body: "Manrope" },
  { name: "Современная", heading: "Manrope", body: "Manrope" },
  { name: "Классическая", heading: "Georgia", body: "Manrope" },
] as const;
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export function blankProject(name = "Новая коллекция"): BoardDocument {
  return {
    schemaVersion: 1,
    id: uid(),
    name,
    description: "Соберите то, что откликается.",
    demo: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 0,
    width: 1400,
    height: 1000,
    background: "#F6F3ED",
    materials: [],
    objects: [],
    kit: {
      colors: {
        background: "#F6F3ED",
        surface: "#FFFEFB",
        text: "#242720",
        muted: "#62665D",
        accent: "#B8472D",
      },
      fontPair: 0,
    },
  };
}
export const hexValid = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
export function safeUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Используйте ссылку http:// или https:// без пароля.");
  return url.href;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const onlyKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((key) => keys.includes(key));
export function validateDocument(v: unknown): asserts v is BoardDocument {
  const fail = () => {
    throw new Error("Архив содержит недопустимый документ FORME.");
  };
  if (
    !record(v) ||
    !onlyKeys(v, [
      "schemaVersion",
      "id",
      "name",
      "description",
      "demo",
      "createdAt",
      "updatedAt",
      "revision",
      "width",
      "height",
      "background",
      "materials",
      "objects",
      "kit",
    ]) ||
    v.schemaVersion !== 1 ||
    !text(v.id, 100) ||
    !text(v.name, 120) ||
    !v.name.trim() ||
    !text(v.description, 1000) ||
    typeof v.demo !== "boolean" ||
    !finite(v.createdAt, 0, 1e15) ||
    !finite(v.updatedAt, 0, 1e15) ||
    !finite(v.revision, 0, 1e12) ||
    !finite(v.width, 320, 4000) ||
    !finite(v.height, 320, 4000) ||
    !hexValid(v.background)
  )
    return fail();
  if (
    !Array.isArray(v.materials) ||
    v.materials.length > 300 ||
    !Array.isArray(v.objects) ||
    v.objects.length > 500 ||
    !record(v.kit) ||
    !record(v.kit.colors) ||
    !onlyKeys(v.kit, ["colors", "fontPair"]) ||
    !onlyKeys(v.kit.colors, roles) ||
    ![0, 1, 2].includes(v.kit.fontPair as number) ||
    !roles.every((r) =>
      hexValid((v.kit as { colors: Record<string, unknown> }).colors[r]),
    )
  )
    return fail();
  const ids = new Set<string>();
  const blobIds = new Set<string>();
  for (const m of v.materials) {
    if (
      !record(m) ||
      !text(m.id, 100) ||
      ids.has(m.id) ||
      !["image", "note", "link"].includes(m.type as string) ||
      !text(m.title, 120) ||
      typeof m.favorite !== "boolean" ||
      !Array.isArray(m.tags) ||
      m.tags.length > 20 ||
      !m.tags.every((t) => text(t, 40)) ||
      !Array.isArray(m.colors) ||
      m.colors.length > 8 ||
      !m.colors.every(hexValid)
    )
      return fail();
    ids.add(m.id);
    const materialFields =
      m.type === "image"
        ? ["blobId", "width", "height"]
        : m.type === "note"
          ? ["text"]
          : ["url"];
    if (
      !onlyKeys(m, [
        "id",
        "type",
        "title",
        "tags",
        "favorite",
        "colors",
        ...materialFields,
      ])
    )
      return fail();
    if (
      m.type === "image" &&
      (!text(m.blobId, 100) ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(m.blobId) ||
        !finite(m.width, 1, 40000) ||
        !finite(m.height, 1, 40000) ||
        (m.width as number) * (m.height as number) > 40e6)
    )
      return fail();
    if (m.type === "note" && !text(m.text, 3000)) return fail();
    if (m.type === "image") {
      if (blobIds.has(m.blobId as string)) return fail();
      blobIds.add(m.blobId as string);
    }
    if (m.type === "link") {
      if (!text(m.url, 2000)) return fail();
      safeUrl(m.url);
    }
  }
  const objectIds = new Set<string>();
  for (const o of v.objects) {
    if (
      !record(o) ||
      !text(o.id, 100) ||
      objectIds.has(o.id) ||
      !["image", "note", "swatch"].includes(o.type as string) ||
      !text(o.title, 120) ||
      !finite(o.x, 0, 4000) ||
      !finite(o.y, 0, 4000) ||
      !finite(o.width, 24, 4000) ||
      !finite(o.height, 24, 4000) ||
      (o.x as number) + (o.width as number) > v.width ||
      (o.y as number) + (o.height as number) > v.height
    )
      return fail();
    objectIds.add(o.id);
    const objectFields =
      o.type === "image"
        ? ["assetId"]
        : o.type === "note"
          ? ["text", "color", "fontSize"]
          : ["color"];
    if (
      !onlyKeys(o, [
        "id",
        "type",
        "title",
        "x",
        "y",
        "width",
        "height",
        ...objectFields,
      ])
    )
      return fail();
    if (
      o.type === "image" &&
      (!ids.has(o.assetId as string) ||
        !v.materials.some((m) => m.id === o.assetId && m.type === "image"))
    )
      return fail();
    if (
      o.type === "note" &&
      (!text(o.text, 3000) ||
        !finite(o.fontSize, 12, 100) ||
        !hexValid(o.color))
    )
      return fail();
    if (o.type === "swatch" && !hexValid(o.color)) return fail();
  }
}
export function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function extractColors(pixels: Uint8ClampedArray): string[] {
  const buckets = new Map<
    number,
    { count: number; r: number; g: number; b: number }
  >();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 32) continue;
    const alpha = pixels[i + 3] / 255;
    const r = Math.round(pixels[i] * alpha + 255 * (1 - alpha)),
      g = Math.round(pixels[i + 1] * alpha + 255 * (1 - alpha)),
      b = Math.round(pixels[i + 2] * alpha + 255 * (1 - alpha));
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const item = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    item.count++;
    item.r += r;
    item.g += g;
    item.b += b;
    buckets.set(key, item);
  }
  const sorted = [...buckets.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[0] - b[0],
  );
  const colors: number[][] = [];
  for (const [, v] of sorted) {
    const c = [v.r, v.g, v.b].map((n) => Math.round(n / v.count));
    if (colors.every((p) => Math.hypot(...c.map((n, i) => n - p[i])) > 42))
      colors.push(c);
    if (colors.length === 6) break;
  }
  return colors.map(
    (c) => "#" + c.map((n) => n.toString(16).padStart(2, "0")).join(""),
  );
}
export function clampObject(o: BoardObject, doc: BoardDocument): BoardObject {
  const width = Math.max(24, Math.min(doc.width, o.width)),
    height = Math.max(24, Math.min(doc.height, o.height));
  return {
    ...o,
    width,
    height,
    x: Math.max(0, Math.min(doc.width - width, o.x)),
    y: Math.max(0, Math.min(doc.height - height, o.y)),
  };
}
export function kitFiles(doc: BoardDocument): Record<string, string> {
  const pair = fontPairs[doc.kit.fontPair],
    c = doc.kit.colors;
  const tokens = {
    version: 1,
    name: doc.name,
    colors: c,
    typography: { heading: pair.heading, body: pair.body },
  };
  const css = `:root {\n${roles.map((r) => `  --${r}: ${c[r]};`).join("\n")}\n  --font-heading: '${pair.heading}', serif;\n  --font-body: '${pair.body}', sans-serif;\n}\n`;
  const title = doc.name.replace(/[\r\n<>`#]/g, "");
  const md = `# ${title}\n\nНабор стилей, экспортированный из FORME.\n\n## Цвета\n\n${roles.map((r) => `- ${r}: ${c[r]}`).join("\n")}\n\n## Типографика\n\nЗаголовки: ${pair.heading}. Основной текст: ${pair.body}.\n\nКонтраст текста к фону: ${contrast(c.text, c.background).toFixed(2)}:1. Проверяйте контраст в конкретных компонентах.\n\nЭто шаблон из фактических настроек проекта, не AI-анализ. Файлы шрифтов не вложены. Cormorant Garamond и Manrope доступны по SIL OFL, Georgia используется как системный шрифт.\n`;
  return {
    "tokens.json": JSON.stringify(tokens, null, 2),
    "theme.css": css,
    "DESIGN.md": md,
  };
}
export class History<T> {
  past: T[] = [];
  future: T[] = [];
  push(value: T) {
    this.past.push(clone(value));
    if (this.past.length > 80) this.past.shift();
    this.future = [];
  }
  undo(current: T) {
    const next = this.past.pop();
    if (next) {
      this.future.push(clone(current));
      return next;
    }
    return current;
  }
  redo(current: T) {
    const next = this.future.pop();
    if (next) {
      this.past.push(clone(current));
      return next;
    }
    return current;
  }
}
