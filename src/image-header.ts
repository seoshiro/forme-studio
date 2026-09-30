export function imageDimensions(buffer: ArrayBuffer): {
  width: number;
  height: number;
  mime: string;
} {
  const v = new DataView(buffer),
    b = new Uint8Array(buffer);
  let width = 0,
    height = 0,
    mime = "";
  if (
    b.length >= 24 &&
    b[0] === 137 &&
    b[1] === 80 &&
    b[2] === 78 &&
    b[3] === 71 &&
    b[4] === 13 &&
    b[5] === 10 &&
    b[6] === 26 &&
    b[7] === 10
  ) {
    width = v.getUint32(16);
    height = v.getUint32(20);
    mime = "image/png";
  } else if (b.length > 12 && b[0] === 255 && b[1] === 216) {
    mime = "image/jpeg";
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i] !== 255) {
        i++;
        continue;
      }
      if (b[i + 1] === 255) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2;
        continue;
      }
      const len = v.getUint16(i + 2);
      if (len < 2 || i + len + 2 > b.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = v.getUint16(i + 5);
        width = v.getUint16(i + 7);
        break;
      }
      i += 2 + len;
    }
  } else if (
    b.length >= 30 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  ) {
    mime = "image/webp";
    const format = String.fromCharCode(...b.slice(12, 16));
    if (format === "VP8X") {
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (format === "VP8L" && b[20] === 0x2f) {
      width = 1 + b[21] + ((b[22] & 63) << 8);
      height = 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10);
    } else if (
      format === "VP8 " &&
      b[23] === 0x9d &&
      b[24] === 0x01 &&
      b[25] === 0x2a
    ) {
      width = v.getUint16(26, true) & 0x3fff;
      height = v.getUint16(28, true) & 0x3fff;
    }
  }
  if (!width || !height || !mime)
    throw new Error("Файл повреждён или не является JPEG, PNG либо WebP.");
  if (width * height > 40_000_000)
    throw new Error(
      "Изображение больше 40 мегапикселей. Уменьшите его перед загрузкой.",
    );
  return { width, height, mime };
}
