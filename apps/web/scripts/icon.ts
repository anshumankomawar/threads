// Arc's macOS icon: the landing page's dot-matrix sunrise (scripts/field.ts), cropped to the band's richest stretch
// and filled into the macOS icon shape. No letterform: the texture is the mark. The dither is drawn at a coarser cell
// than the page's so it still reads as dots at 32px.
//
//   vpx scripts/icon.ts <source.bmp> <out.png> [--cell 10] [--dot 7] [--levels 6] [--shuttle cx,cy,rx,ry,dx,dy]
//
// `--shuttle` paints Endeavour out: an ellipse (in cells) filled from `dx,dy` cells further along the band each way.
//
// How brand/Arc.icns is made (the band crossing the square from the lower left, Endeavour painted out at the cells
// measured in the shrunk crop):
//
//   sips -s format bmp -c 2200 2200 --cropOffset 400 1000 scripts/source/endeavour.jpeg --out crop.bmp
//   sips -z 128 128 crop.bmp --out crop128.bmp
//   vpx scripts/icon.ts crop128.bmp brand/Arc-1024.png --cell 8 --dot 6 --shuttle 64,55,9,7,5,11
//   mkdir Arc.iconset && for s in 16 32 128 256 512; do sips -z $s $s brand/Arc-1024.png --out Arc.iconset/icon_${s}x${s}.png;
//     sips -z $((s*2)) $((s*2)) brand/Arc-1024.png --out Arc.iconset/icon_${s}x${s}@2x.png; done
//   iconutil -c icns Arc.iconset -o brand/Arc.icns
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const [srcFile, outFile] = args;
const CELL = flag("cell", 10);
const DOT = flag("dot", 7);
const LEVELS = flag("levels", 6);
const SIZE = 1024;
const N = Math.ceil(SIZE / CELL); // cells a side (the last column and row may be cut by the edge)

type RGB = [number, number, number];

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

const raw0 = readBmp(srcFile);
const shuttleArg = args.indexOf("--shuttle");
const SH = shuttleArg >= 0 ? args[shuttleArg + 1]!.split(",").map(Number) : null;
// The source with the shuttle painted out, as field.ts does: the patch filled from the band on either side.
const src = {
  w: raw0.w,
  h: raw0.h,
  at(x: number, y: number): RGB {
    const p = raw0.at(x, y);
    if (!SH) return p;
    const [cx, cy, rx, ry, dx, dy] = SH as [number, number, number, number, number, number];
    const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (e >= 1) return p;
    const a = raw0.at(
      Math.min(raw0.w - 1, Math.max(0, x + dx)),
      Math.min(raw0.h - 1, Math.max(0, y + dy)),
    );
    const b = raw0.at(
      Math.min(raw0.w - 1, Math.max(0, x - dx)),
      Math.min(raw0.h - 1, Math.max(0, y - dy)),
    );
    const fill: RGB = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const k = Math.min(1, (1 - e) * 3);
    return [p[0] + (fill[0] - p[0]) * k, p[1] + (fill[1] - p[1]) * k, p[2] + (fill[2] - p[2]) * k];
  },
};
if (src.w !== N || src.h !== N)
  throw new Error(`Expected a ${N}×${N} source for cell ${CELL}, got ${src.w}×${src.h}`);

let seed = 7;
const rand = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

// The cells' colours: the photo deepened and dimmed as the dark page's field is, with its noise.
function cells(): Float32Array {
  const a = new Float32Array(N * N * 3);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const p = src.at(x, y);
      for (let c = 0; c < 3; c++)
        a[(y * N + x) * 3 + c] = p[c]! ** 1.4 * 0.95 + (rand() * 2 - 1) * 0.12 + 0.12 * 0.35;
    }
  return a;
}

function diffuse(a: Float32Array): Uint8Array {
  const step = 1 / (LEVELS - 1);
  const out = new Uint8Array(a.length);
  const at = (x: number, y: number, c: number): number => (y * N + x) * 3 + c;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      for (let c = 0; c < 3; c++) {
        const i = at(x, y, c);
        const old = a[i]!;
        const q = Math.min(1, Math.max(0, Math.round(old / step) * step));
        out[i] = Math.round(q * 255);
        const err = old - q;
        if (x + 1 < N) a[at(x + 1, y, c)]! += (err * 7) / 16;
        if (y + 1 < N) {
          if (x > 0) a[at(x - 1, y + 1, c)]! += (err * 3) / 16;
          a[at(x, y + 1, c)]! += (err * 5) / 16;
          if (x + 1 < N) a[at(x + 1, y + 1, c)]! += (err * 1) / 16;
        }
      }
  return out;
}

// macOS's icon shape: a squircle of 824px on the 1024px canvas (Apple's grid), radius about 22.37% of its side, with
// Apple's superellipse-ish corners approximated by a rounded rect of that radius. Pixels outside are transparent.
const ICON = 824;
const INSET = (SIZE - ICON) / 2;
const RADIUS = ICON * 0.2237;
function coverage(px: number, py: number): number {
  // Supersampled alpha at the edge, so the outline is smooth.
  let inside = 0;
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 4; sx++) {
      const x = px + (sx + 0.5) / 4 - INSET;
      const y = py + (sy + 0.5) / 4 - INSET;
      const cx = Math.min(Math.max(x, RADIUS), ICON - RADIUS);
      const cy = Math.min(Math.max(y, RADIUS), ICON - RADIUS);
      const dx = x - cx,
        dy = y - cy;
      // A superellipse (n = 5) corner reads closer to Apple's than a circle.
      const d = (Math.abs(dx) / RADIUS) ** 5 + (Math.abs(dy) / RADIUS) ** 5;
      if (x >= 0 && y >= 0 && x <= ICON && y <= ICON && d <= 1) inside++;
    }
  return inside / 16;
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

const q = diffuse(cells());
const ground: RGB = [10, 10, 11];
const raw = new Uint8Array(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const row = y * (1 + SIZE * 4);
  raw[row] = 0;
  const cy = Math.floor(y / CELL);
  const inDotY = y % CELL < DOT;
  for (let x = 0; x < SIZE; x++) {
    const i = row + 1 + x * 4;
    const alpha = coverage(x, y);
    if (alpha === 0) continue;
    const cx = Math.floor(x / CELL);
    let rgb: RGB = ground;
    if (inDotY && x % CELL < DOT) {
      const j = (cy * N + cx) * 3;
      rgb = [q[j]!, q[j + 1]!, q[j + 2]!];
    }
    raw[i] = rgb[0];
    raw[i + 1] = rgb[1];
    raw[i + 2] = rgb[2];
    raw[i + 3] = Math.round(alpha * 255);
  }
}
const header = new Uint8Array(13);
const hv = new DataView(header.buffer);
hv.setUint32(0, SIZE);
hv.setUint32(4, SIZE);
header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const parts = [
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
  chunk("IEND", new Uint8Array(0)),
];
const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
let at = 0;
for (const p of parts) {
  png.set(p, at);
  at += p.length;
}
writeFileSync(outFile, png);
void execFileSync;
console.log(
  `${outFile}  ${SIZE}×${SIZE}  cell ${CELL}  ${(statSync(outFile).size / 1024).toFixed(1)} kB`,
);
