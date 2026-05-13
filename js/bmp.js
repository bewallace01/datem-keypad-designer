// js/bmp.js
// Convert an arbitrary image (PNG/JPG/BMP/GIF) into a 24-bit Windows BMP
// suitable for DAT/EM Keypad Controller. The browser handles decoding via
// HTMLImageElement; we then draw to a sized canvas and serialize the pixel
// data ourselves into the BMP file format.
//
// DAT/EM expects 24-bit uncompressed BMP. Typical keypad icon size is 24x24,
// which is what we render to by default.

export const DEFAULT_BMP_SIZE = 24;

export async function fileToBmp(file, size = DEFAULT_BMP_SIZE) {
  const dataUrl = await readAsDataUrl(file);
  return await imageToBmp(dataUrl, size);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read file"));
    r.readAsDataURL(file);
  });
}

function imageToBmp(dataUrl, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        // BMP has no alpha — paint a white background first so transparent
        // pixels don't render as black on the keypad.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // Letterbox: preserve aspect ratio, center on the white canvas.
        const scale = Math.min(size / img.width, size / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const x = Math.round((size - w) / 2);
        const y = Math.round((size - h) / 2);
        ctx.drawImage(img, x, y, w, h);
        const imgData = ctx.getImageData(0, 0, size, size);
        resolve(encodeBmp(imgData.data, size, size));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

export function encodeBmp(rgba, width, height) {
  const rowSize = (width * 3 + 3) & ~3; // 4-byte aligned
  const imageSize = rowSize * height;
  const fileSize = 14 + 40 + imageSize;
  const out = new Uint8Array(fileSize);
  const dv = new DataView(out.buffer);

  out[0] = 0x42; out[1] = 0x4d; // 'BM'
  dv.setUint32(2, fileSize, true);
  dv.setUint32(10, 54, true);

  dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, imageSize, true);

  let dst = 54;
  for (let y = height - 1; y >= 0; y--) {
    let src = y * width * 4;
    for (let x = 0; x < width; x++) {
      out[dst++] = rgba[src + 2];
      out[dst++] = rgba[src + 1];
      out[dst++] = rgba[src + 0];
      src += 4;
    }
    // Pad row to 4-byte boundary
    while (dst & 3) out[dst++] = 0;
  }
  return out;
}

export function bytesToDataUrl(bytes, mime = "image/bmp") {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(s)}`;
}

export function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Auto-generate a filename for a custom bitmap. We strip extension/punctuation
// from the source filename, ensure it's lowercase + ASCII-safe, and append a
// disambiguator if needed.
export function makeBitmapName(sourceFilename, existing = {}) {
  const base = (sourceFilename || "icon")
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 24) || "icon";
  let name = `${base}.bmp`;
  let n = 1;
  while (existing[name]) {
    name = `${base}_${n}.bmp`;
    n++;
  }
  return name;
}
