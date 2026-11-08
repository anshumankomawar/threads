// The page's background: NASA's photograph of Endeavour silhouetted against the atmosphere (ISS022-E-062672, public
// domain; scripts/source), the shuttle painted out, shrunk to a grid of cells and dithered into dots, as the app's
// empty pane draws it (apps/desktop/scripts/horizon): each colour channel diffused (Floyd–Steinberg) down to a few
// levels, and each cell a square dot on near-black, as a dot-matrix screen would. The page draws it at half size, so
// every dot lands on whole pixels on a Retina screen.
//
//   sips -s format bmp -c 2475 3300 --cropOffset 250 200 scripts/source/endeavour.jpeg --out crop.bmp
//   sips -z 300 400 crop.bmp --out scripts/source/endeavour-400.bmp    (crop first; sips resizes before it crops)
//   vpx scripts/field.ts    writes public/field-dark.webp and public/field-light.webp
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const COLS = 400;
const ROWS = 300;
const CELL = 6;
const DOT = 4;
const LEVELS = 6;
const root = fileURLToPath(new URL("..", import.meta.url));

type RGB = [number, number, number];

// A 24- or 32-bit uncompressed BMP, as sips writes it: rows bottom-up, BGR(A).
function readBmp(file: string): { w: number; h: number; at: (x: number, y: number) => RGB } {
  const b = readFileSync(file);
  const offset = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h = Math.abs(b.readInt32LE(22));
  const bottomUp = b.readInt32LE(22) > 0;
  const bpp = b.readUInt16LE(28) / 8;
  const stride = Math.ceil((w * bpp) / 4) * 4;
  const at = (x: number, y: number): RGB => {
    const row = bottomUp ? h - 1 - y : y;
    const i = offset + row * stride + x * bpp;
    return [b[i + 2]! / 255, b[i + 1]! / 255, b[i]! / 255];
  };
  return { w, h, at };
}

const src = readBmp(`${root}scripts/source/endeavour-400.bmp`);
if (src.w !== COLS || src.h !== ROWS)
  throw new Error(`Expected a ${COLS}×${ROWS} source, got ${src.w}×${src.h}`);

// The shuttle's patch: an ellipse over it, filled from the same place further along the band (which runs down and
// to the right) in both directions, feathered at its edge.
const SHUTTLE = { cx: 230, cy: 133, rx: 19, ry: 16 };
const ALONG = { x: 24, y: 55 };
function photo(x: number, y: number): RGB {
  const e = ((x - SHUTTLE.cx) / SHUTTLE.rx) ** 2 + ((y - SHUTTLE.cy) / SHUTTLE.ry) ** 2;
  const p = src.at(x, y);
  if (e >= 1) return p;
  const a = src.at(Math.min(COLS - 1, x + ALONG.x), Math.min(ROWS - 1, y + ALONG.y));
  const b = src.at(Math.max(0, x - ALONG.x), Math.max(0, y - ALONG.y));
  const fill: RGB = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const k = Math.min(1, (1 - e) * 3);
  return [p[0] + (fill[0] - p[0]) * k, p[1] + (fill[1] - p[1]) * k, p[2] + (fill[2] - p[2]) * k];
}

// Deterministic noise, so the dark turns to faint coloured static rather than flat black.
let seed = 7;
const rand = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

// The cells' colours, ready to dither: the photo deepened (gamma) and dimmed, with a little noise.
function cells(light: boolean): Float32Array {
  const a = new Float32Array(ROWS * COLS * 3);
  const darken = light ? 1 : 0.95;
  const noise = light ? 0.05 : 0.12;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = photo(x, y);
      for (let c = 0; c < 3; c++) {
        let v = p[c]! ** 1.4 * darken + (rand() * 2 - 1) * noise + noise * 0.35;
        // On a light page the photo keeps its colour: space becomes paper, and the band's blue and orange are
        // laid on it at full strength, so the page is white with a real sunrise across it rather than a wash.
        if (light) {
          const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          const presence = Math.min(1, Math.max(0, (lum - 0.06) / 0.5)); // how much of the scene is here
          const sat = (p[c]! - lum) * 1.6; // its colour, boosted
          const ink = 0.55 + sat; // the band's own tone: mid-bright, in its hue
          v = 1 - presence * (1 - Math.min(1, Math.max(0, ink))) + (rand() * 2 - 1) * noise * 0.5;
        }
        a[(y * COLS + x) * 3 + c] = v;
      }
    }
  return a;
}

// Floyd–Steinberg: each cell rounded to the nearest level, the error pushed to the cells after it.
function diffuse(a: Float32Array): Uint8Array {
  const step = 1 / (LEVELS - 1);
  const out = new Uint8Array(a.length);
  const at = (x: number, y: number, c: number): number => (y * COLS + x) * 3 + c;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      for (let c = 0; c < 3; c++) {
        const i = at(x, y, c);
        const old = a[i]!;
        const q = Math.min(1, Math.max(0, Math.round(old / step) * step));
        out[i] = Math.round(q * 255);
        const err = old - q;
        if (x + 1 < COLS) a[at(x + 1, y, c)]! += (err * 7) / 16;
        if (y + 1 < ROWS) {
          if (x > 0) a[at(x - 1, y + 1, c)]! += (err * 3) / 16;
          a[at(x, y + 1, c)]! += (err * 5) / 16;
          if (x + 1 < COLS) a[at(x + 1, y + 1, c)]! += (err * 1) / 16;
        }
      }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

function png(light: boolean): Uint8Array {
  const W = COLS * CELL;
  const H = ROWS * CELL;
  const q = diffuse(cells(light));
  const ground: RGB = light ? [252, 252, 252] : [10, 10, 11];
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    raw[row] = 0;
    const cy = Math.floor(y / CELL);
    const inDotY = y % CELL < DOT;
    for (let x = 0; x < W; x++) {
      const i = row + 1 + x * 3;
      const cx = Math.floor(x / CELL);
      if (inDotY && x % CELL < DOT) {
        const j = (cy * COLS + cx) * 3;
        raw[i] = q[j]!;
        raw[i + 1] = q[j + 1]!;
        raw[i + 2] = q[j + 2]!;
      } else {
        raw[i] = ground[0];
        raw[i + 1] = ground[1];
        raw[i + 2] = ground[2];
      }
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, W);
  view.setUint32(4, H);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Written as PNG, then converted to lossless WebP (half the size for a dot-matrix image) with cwebp, which Homebrew
// installs (`brew install webp`).
for (const light of [false, true]) {
  const name = `field-${light ? "light" : "dark"}`;
  const pngFile = `${root}scripts/source/${name}.png`;
  writeFileSync(pngFile, png(light));
  const webp = `${root}public/${name}.webp`;
  execFileSync("cwebp", ["-quiet", "-lossless", "-z", "9", pngFile, "-o", webp]);
  console.log(
    `public/${name}.webp  ${COLS * CELL}×${ROWS * CELL}  ${(statSync(webp).size / 1024).toFixed(1)} kB`,
  );
}
