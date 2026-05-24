/**
 * Nest Extension — Icon Generator
 * Creates minimal solid-color PNG icons using pure Node.js (no external deps)
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function uint32BE(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBytes, data]);
  return Buffer.concat([uint32BE(data.length), typeBytes, data, uint32BE(crc32(crcData))]);
}

function createPNG(size, r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB color type

  // Build raw scanlines (filter byte 0 + 3 bytes per pixel)
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const base = y * (1 + size * 3);
    raw[base] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 2 + x * 3] = g;
      raw[base + 3 + x * 3] = b;
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });

// Dark cyan/teal brand color: #0e7490
const R = 14, G = 116, B = 144;

for (const size of [16, 48, 128]) {
  const file = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(file, createPNG(size, R, G, B));
  console.log(`[Icons] Generated icon${size}.png`);
}
