#!/usr/bin/env node
// Draws the site icon (equaliser bars on the dark panel colour) and writes it as
//   site/favicon.svg, site/favicon.ico (32 px PNG inside an .ico) and site/apple-touch-icon.png (180 px).
// No dependencies. Run from the repository root:  node build/make-icons.mjs
// The generated files are committed; run this again only if the design changes.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const BG = [20, 26, 25];          // --bg   #141a19
const ACCENT = [114, 196, 186];   // --accent #72c4ba
const BARS = [0.34, 0.62, 0.88, 0.5];   // relative heights, left to right

// ---- geometry shared by the SVG and the bitmap (all in a 100 x 100 box) ------------------------
const RADIUS = 22;
const BAR_W = 12, GAP = 7;
const totalW = BARS.length * BAR_W + (BARS.length - 1) * GAP;
const x0 = (100 - totalW) / 2;
const rects = BARS.map((h, i) => {
  const height = h * 62;
  return { x: x0 + i * (BAR_W + GAP), y: 81 - height, w: BAR_W, h: height, r: 3 };
});

// ---- SVG --------------------------------------------------------------------------------------
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" rx="' + RADIUS + '" fill="' + hex(BG) + '"/>' +
  rects.map((r) => '<rect x="' + r.x + '" y="' + r.y.toFixed(2) + '" width="' + r.w + '" height="' + r.h.toFixed(2) + '" rx="' + r.r + '" fill="' + hex(ACCENT) + '"/>').join("") +
  "</svg>\n";

// ---- bitmap -----------------------------------------------------------------------------------
const insideRounded = (px, py, x, y, w, h, r) => {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

function render(size) {
  const SS = 4;   // supersampling for smooth edges
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, red = 0, green = 0, blue = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x + (sx + 0.5) / SS) / size) * 100;
          const py = ((y + (sy + 0.5) / SS) / size) * 100;
          if (!insideRounded(px, py, 0, 0, 100, 100, RADIUS)) continue;
          const bar = rects.some((r) => insideRounded(px, py, r.x, r.y, r.w, r.h, r.r));
          const c = bar ? ACCENT : BG;
          a += 1; red += c[0]; green += c[1]; blue += c[2];
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      out[i] = a ? Math.round(red / a) : 0;
      out[i + 1] = a ? Math.round(green / a) : 0;
      out[i + 2] = a ? Math.round(blue / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

// ---- PNG encoder ------------------------------------------------------------------------------
const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const pixels = render(size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0;   // filter: none
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---- ICO wrapping one PNG ---------------------------------------------------------------------
function ico(size) {
  const image = png(size);
  const dir = Buffer.alloc(6 + 16);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);   // reserved, type icon, 1 image
  dir[6] = size; dir[7] = size; dir[8] = 0; dir[9] = 0;
  dir.writeUInt16LE(1, 10); dir.writeUInt16LE(32, 12);                          // planes, bits per pixel
  dir.writeUInt32LE(image.length, 14); dir.writeUInt32LE(22, 18);               // size, offset
  return Buffer.concat([dir, image]);
}

fs.writeFileSync(path.join(SITE, "favicon.svg"), svg);
fs.writeFileSync(path.join(SITE, "favicon.ico"), ico(32));
fs.writeFileSync(path.join(SITE, "apple-touch-icon.png"), png(180));
console.log("wrote site/favicon.svg, site/favicon.ico, site/apple-touch-icon.png");
