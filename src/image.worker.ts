import { extractColors } from "./model";
import { imageDimensions } from "./image-header";
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; file: Blob }>) => void) | null;
  postMessage: (data: unknown) => void;
};
scope.onmessage = async ({ data: { id, file } }) => {
  try {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("Файл больше 10 МиБ. Уменьшите изображение.");
    const dimensions = imageDimensions(await file.arrayBuffer());
    if (file.type && file.type !== dimensions.mime)
      throw new Error("Тип файла не соответствует его содержимому.");
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 40_000_000) {
      bitmap.close();
      throw new Error("Изображение больше 40 мегапикселей.");
    }
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await canvas.convertToBlob({
      type: "image/webp",
      quality: 0.82,
    });
    const sample = new OffscreenCanvas(96, 96);
    const sampleCtx = sample.getContext("2d", { willReadFrequently: true })!;
    sampleCtx.drawImage(bitmap, 0, 0, 96, 96);
    const colors = extractColors(sampleCtx.getImageData(0, 0, 96, 96).data);
    const width = bitmap.width,
      height = bitmap.height;
    bitmap.close();
    scope.postMessage({
      id,
      width,
      height,
      thumbnail,
      colors,
      mime: dimensions.mime,
    });
  } catch (error) {
    scope.postMessage({
      id,
      error:
        error instanceof Error
          ? error.message
          : "Не удалось обработать изображение.",
    });
  }
};
