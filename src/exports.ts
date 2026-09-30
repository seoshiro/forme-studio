import JSZip from "jszip";
import {
  clone,
  kitFiles,
  uid,
  validateDocument,
  type BoardDocument,
  type BoardObject,
} from "./model";
import { processImage } from "./images";
import { type StoredImage, type ProjectSession, writeProject } from "./storage";
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function filename(name: string) {
  return (
    [...name]
      .filter(
        (c) =>
          c.charCodeAt(0) >= 32 && !'< >:"/\\|?*'.replace(" ", "").includes(c),
      )
      .join("")
      .slice(0, 80) || "forme"
  );
}
export async function archiveBlob(session: ProjectSession): Promise<Blob> {
  const zip = new JSZip();
  const doc = clone(session.doc);
  validateDocument(doc);
  const manifest = JSON.stringify(doc);
  if (new TextEncoder().encode(manifest).length > 20 * 1024 * 1024)
    throw new Error("Документ превышает допустимый размер 20 МиБ.");
  zip.file("manifest.json", manifest);
  let total = new TextEncoder().encode(manifest).length;
  for (const asset of doc.materials) {
    if (asset.type !== "image" || !asset.blobId) continue;
    const { blob } = await session.image(asset.blobId);
    total += blob.size;
    if (total > 200 * 1024 * 1024)
      throw new Error("Архив превысит 200 МиБ. Разделите коллекцию.");
    zip.file(`images/${asset.blobId}`, await blob.arrayBuffer());
  }
  return zip.generateAsync({
    type: "blob",
    compression: "STORE",
    mimeType: "application/zip",
  });
}
export function inspectZip(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  if (buffer.byteLength > 210 * 1024 * 1024)
    throw new Error("Архив больше 210 МиБ.");
  const end = buffer.byteLength - 22;
  if (
    end < 0 ||
    v.getUint32(end, true) !== 0x06054b50 ||
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true) ||
    v.getUint16(end + 20, true)
  )
    throw new Error("Неверный или многотомный ZIP.");
  const count = v.getUint16(end + 10, true);
  if (!count || count > 302 || count !== v.getUint16(end + 8, true))
    throw new Error("Неверное количество файлов в архиве.");
  const central = v.getUint32(end + 16, true);
  if (central + v.getUint32(end + 12, true) !== end)
    throw new Error("Повреждён размер каталога архива.");
  let pos = central,
    total = 0,
    localEnd = 0;
  const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > end || v.getUint32(pos, true) !== 0x02014b50)
      throw new Error("Повреждён каталог архива.");
    const flags = v.getUint16(pos + 8, true),
      method = v.getUint16(pos + 10, true),
      size = v.getUint32(pos + 24, true),
      compressed = v.getUint32(pos + 20, true),
      nameLen = v.getUint16(pos + 28, true),
      extra = v.getUint16(pos + 30, true),
      comment = v.getUint16(pos + 32, true);
    const name = new TextDecoder().decode(
      buffer.slice(pos + 46, pos + 46 + nameLen),
    );
    if (
      (flags & ~0x0800) !== 0 ||
      method !== 0 ||
      compressed !== size ||
      size === 0xffffffff ||
      names.has(name) ||
      extra !== 0 ||
      comment !== 0 ||
      v.getUint16(pos + 6, true) > 20 ||
      v.getUint16(pos + 34, true) !== 0 ||
      !/^(manifest\.json|images\/|images\/[a-zA-Z0-9-]{1,100})$/.test(name)
    )
      throw new Error(
        "Поддерживаются только архивы FORME без сжатия, со стандартными файлами и путями.",
      );
    const local = v.getUint32(pos + 42, true);
    const attributes = v.getUint32(pos + 38, true);
    const unixType = (attributes >>> 16) & 0xf000;
    const directory = name === "images/";
    if (
      Boolean(attributes & 0x10) !== directory ||
      (unixType !== 0 && unixType !== (directory ? 0x4000 : 0x8000)) ||
      (directory && (size !== 0 || v.getUint32(pos + 16, true) !== 0))
    )
      throw new Error("Недопустимый тип файла в архиве.");
    if (
      local !== localEnd ||
      local + 30 > central ||
      v.getUint32(local, true) !== 0x04034b50 ||
      v.getUint16(local + 4, true) !== v.getUint16(pos + 6, true) ||
      v.getUint16(local + 6, true) !== flags ||
      v.getUint16(local + 8, true) !== method ||
      v.getUint32(local + 14, true) !== v.getUint32(pos + 16, true) ||
      v.getUint32(local + 18, true) !== compressed ||
      v.getUint32(local + 22, true) !== size ||
      v.getUint16(local + 26, true) !== nameLen ||
      v.getUint16(local + 28, true) !== 0
    )
      throw new Error("Повреждён заголовок файла в архиве.");
    const start =
      local +
      30 +
      v.getUint16(local + 26, true) +
      v.getUint16(local + 28, true);
    if (start + size > central || pos + 46 + nameLen + extra + comment > end)
      throw new Error("Повреждён размер файла в архиве.");
    if (new TextDecoder().decode(buffer.slice(local + 30, start)) !== name)
      throw new Error("Имена файла в заголовках архива не совпадают.");
    if (size > (name === "manifest.json" ? 20 * 1024 * 1024 : 10 * 1024 * 1024))
      throw new Error("Файл внутри архива превышает допустимый размер.");
    total += size;
    if (total > 200 * 1024 * 1024)
      throw new Error("Распакованный архив больше 200 МиБ.");
    names.add(name);
    localEnd = start + size;
    pos += 46 + nameLen + extra + comment;
  }
  if (pos !== end || localEnd !== central)
    throw new Error("Архив содержит незаявленные записи или данные.");
  if (!names.has("manifest.json"))
    throw new Error("В архиве нет manifest.json.");
  return names;
}
export async function importArchive(file: File): Promise<BoardDocument> {
  if (file.size > 210 * 1024 * 1024) throw new Error("Архив больше 210 МиБ.");
  const buffer = await file.arrayBuffer();
  const names = inspectZip(buffer);
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const manifest = await zip.file("manifest.json")!.async("string");
  let doc: unknown;
  try {
    doc = JSON.parse(manifest);
  } catch {
    throw new Error("Повреждён manifest.json в архиве FORME.");
  }
  validateDocument(doc);
  const expected = new Set([
    "manifest.json",
    "images/",
    ...doc.materials
      .filter((m) => m.type === "image")
      .map((m) => `images/${m.blobId}`),
  ]);
  if ([...names].some((name) => !expected.has(name)))
    throw new Error("Архив содержит изображения, не указанные в документе.");
  const restored = clone(doc);
  const images: StoredImage[] = [];
  for (const material of restored.materials) {
    if (material.type !== "image") continue;
    const entry = zip.file(`images/${material.blobId}`);
    if (!entry)
      throw new Error(`В архиве отсутствует изображение «${material.title}».`);
    const bytes = await entry.async("uint8array");
    const source = new Blob([bytes as BlobPart]);
    const processed = await processImage(source);
    const id = uid();
    material.blobId = id;
    material.width = processed.width;
    material.height = processed.height;
    material.colors = processed.colors;
    images.push({
      id,
      blob: new Blob([bytes as BlobPart], { type: processed.mime }),
      thumbnail: processed.thumbnail,
    });
  }
  restored.id = uid();
  restored.name = (restored.name + " · копия").slice(0, 120);
  restored.revision = 0;
  restored.demo = false;
  restored.createdAt = restored.updatedAt = Date.now();
  restored.revision = await writeProject(restored, 0, images);
  return restored;
}
export async function kitBlob(doc: BoardDocument) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(kitFiles(doc)))
    zip.file(name, content);
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
function wrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  max: number,
  line: number,
  bottom: number,
) {
  let row = "";
  const tab = ctx.measureText(" ").width * 8;
  const width = (value: string) =>
    value.split("\t").reduce((x, part, i, parts) => {
      const next = x + ctx.measureText(part).width;
      return i < parts.length - 1 ? (Math.floor(next / tab) + 1) * tab : next;
    }, 0);
  const draw = () => {
    let offset = 0;
    for (const part of row.split("\t")) {
      if (y <= bottom) ctx.fillText(part, x + offset, y);
      offset += ctx.measureText(part).width;
      offset = (Math.floor(offset / tab) + 1) * tab;
    }
    row = "";
    y += line;
  };
  for (const paragraph of text.split("\n")) {
    for (const word of paragraph.match(/[^\S\n]+|\S+/g) ?? []) {
      if (!/^\s+$/.test(word) && row && width(row + word) > max) draw();
      const parts =
        width(word) > max && !/^\s+$/.test(word)
          ? [
              ...new Intl.Segmenter(undefined, {
                granularity: "grapheme",
              }).segment(word),
            ].map((p) => p.segment)
          : [word];
      for (const part of parts) {
        if (row && parts.length > 1 && width(row + part) > max) draw();
        row += part;
      }
    }
    draw();
  }
}
async function drawObject(
  ctx: CanvasRenderingContext2D,
  o: BoardObject,
  session: ProjectSession,
  doc: BoardDocument,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(o.x, o.y, o.width, o.height);
  ctx.clip();
  if (o.type === "image") {
    const material = doc.materials.find((m) => m.id === o.assetId);
    if (!material?.blobId) throw new Error("Изображение на доске отсутствует.");
    const image = await createImageBitmap(
      (await session.image(material.blobId)).blob,
    );
    try {
      const scale = Math.max(o.width / image.width, o.height / image.height);
      const w = image.width * scale,
        h = image.height * scale;
      ctx.drawImage(
        image,
        o.x + (o.width - w) / 2,
        o.y + (o.height - h) / 2,
        w,
        h,
      );
    } finally {
      image.close();
    }
  } else if (o.type === "swatch") {
    ctx.fillStyle = o.color!;
    ctx.fillRect(o.x, o.y, o.width, o.height);
  } else {
    ctx.fillStyle = o.color!;
    ctx.fillRect(o.x, o.y, o.width, o.height);
    ctx.fillStyle = "#242720";
    ctx.font = `${o.fontSize ?? 28}px Manrope`;
    ctx.textBaseline = "alphabetic";
    const size = o.fontSize ?? 28;
    const metrics = ctx.measureText("Mg");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    wrappedText(
      ctx,
      o.text ?? "",
      o.x + 24,
      o.y + 24 + (size * 1.5 - ascent - descent) / 2 + ascent,
      o.width - 48,
      (o.fontSize ?? 28) * 1.5,
      o.y + o.height + ascent,
    );
  }
  ctx.restore();
}
export async function pngBlob(session: ProjectSession): Promise<Blob> {
  const doc = clone(session.doc);
  if (doc.width * doc.height > 16_000_000)
    throw new Error("PNG ограничен 16 мегапикселями.");
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const object of doc.objects) await drawObject(ctx, object, session, doc);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Браузер не смог создать PNG."));
    }, "image/png"),
  );
}
