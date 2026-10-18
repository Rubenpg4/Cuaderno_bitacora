import { cp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
await mkdir('src-tauri/resources', { recursive: true });
await mkdir('src-tauri/binaries', { recursive: true });
await mkdir('src-tauri/icons', { recursive: true });
await cp('dist-service', 'src-tauri/resources/service', { recursive: true });
const target = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
await copyFile(
  process.execPath,
  `src-tauri/binaries/bitacora-node-${target}${process.platform === 'win32' ? '.exe' : ''}`,
);
// Small original book mark, created as an RGBA PNG and an ICO container.
function crc(b) {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
}
const n = 64,
  pixels = Buffer.alloc((n * 4 + 1) * n);
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    const p = y * (n * 4 + 1) + 1 + x * 4;
    const book = x >= 15 && x <= 49 && y >= 12 && y <= 52;
    const spine = x >= 19 && x <= 21 && book;
    const line = x >= 27 && x <= 42 && [24, 25, 32, 33, 40, 41].includes(y);
    const col = book ? (spine || line ? [55, 107, 187] : [245, 249, 255]) : [31, 65, 107];
    pixels.set([...col, 255], p);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(n, 0);
ihdr.writeUInt32BE(n, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
await writeFile('src-tauri/icons/icon.png', png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = n;
ico[7] = n;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
await writeFile('src-tauri/icons/icon.ico', Buffer.concat([ico, png]));
console.log('Recursos de escritorio preparados.');
