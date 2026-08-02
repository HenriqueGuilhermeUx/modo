import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, "../assets");
mkdirSync(assets, { recursive: true });

const NAVY = [13, 27, 62, 255];
const BLUE = [31, 94, 255, 255];
const GREEN = [46, 209, 154, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const crossed = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;
    if (crossed) inside = !inside;
  }
  return inside;
}

function roundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function logoPixel(x, y, mode) {
  const transparent = mode !== "icon";
  let color = transparent ? CLEAR : NAVY;
  const plate = mode === "icon"
    ? [0.15, 0.15, 0.85, 0.85, 0.18]
    : [0.22, 0.22, 0.78, 0.78, 0.15];

  if (roundedRect(x, y, ...plate)) color = BLUE;

  const m = mode === "icon"
    ? [[0.29, 0.69], [0.29, 0.34], [0.40, 0.34], [0.50, 0.50], [0.60, 0.34], [0.71, 0.34], [0.71, 0.69], [0.61, 0.69], [0.61, 0.50], [0.50, 0.66], [0.39, 0.50], [0.39, 0.69]]
    : [[0.32, 0.65], [0.32, 0.38], [0.41, 0.38], [0.50, 0.51], [0.59, 0.38], [0.68, 0.38], [0.68, 0.65], [0.60, 0.65], [0.60, 0.50], [0.50, 0.63], [0.40, 0.50], [0.40, 0.65]];
  if (pointInPolygon(x, y, m)) color = WHITE;

  const dotX = mode === "icon" ? 0.72 : 0.70;
  const dotY = mode === "icon" ? 0.29 : 0.32;
  const dotRadius = mode === "icon" ? 0.055 : 0.045;
  if ((x - dotX) ** 2 + (y - dotY) ** 2 <= dotRadius ** 2) color = GREEN;
  return color;
}

function createPng(size, mode) {
  const rowBytes = size * 4 + 1;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * rowBytes;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = logoPixel((x + 0.5) / size, (y + 0.5) / size, mode);
      const offset = row + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(resolve(assets, "icon.png"), createPng(1024, "icon"));
writeFileSync(resolve(assets, "adaptive-icon.png"), createPng(1024, "adaptive"));
writeFileSync(resolve(assets, "splash-icon.png"), createPng(1024, "splash"));
console.log("MODO mobile assets generated.");
