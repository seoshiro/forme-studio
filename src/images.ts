export type ProcessedImage = {
  width: number;
  height: number;
  thumbnail: Blob;
  colors: string[];
  mime: string;
};
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (v: ProcessedImage) => void;
    reject: (e: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
export function processImage(file: Blob): Promise<ProcessedImage> {
  if (!worker) {
    worker = new Worker(new URL("./image.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const item = pending.get(data.id);
      if (!item) return;
      clearTimeout(item.timeout);
      pending.delete(data.id);
      if (data.error) item.reject(new Error(data.error));
      else item.resolve(data);
    };
    worker.onerror = () => {
      for (const item of pending.values()) {
        clearTimeout(item.timeout);
        item.reject(
          new Error("Обработчик изображений недоступен. Обновите страницу."),
        );
      }
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          "Обработка заняла слишком много времени. Попробуйте файл меньшего размера.",
        ),
      );
    }, 30000);
    pending.set(id, { resolve, reject, timeout });
    worker!.postMessage({ id, file });
  });
}
