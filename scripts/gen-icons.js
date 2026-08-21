// シンプルなアプリアイコンPNGを外部依存なしで生成するスクリプト
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size, drawFn) {
  const width = size, height = size;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const px = new Uint8Array(width * height * 4);
  const setPixel = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  drawFn(setPixel, width, height);

  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter type none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[offset++] = px[i];
      raw[offset++] = px[i + 1];
      raw[offset++] = px[i + 2];
      raw[offset++] = px[i + 3];
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(setPixel, w, h) {
  const bg = [79, 70, 229]; // indigo
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPixel(x, y, bg[0], bg[1], bg[2], 255);
  }
  // チェックリスト風ピクトグラム(白い四角+バー)
  const rows = [
    { y: h * 0.28, barW: w * 0.52 },
    { y: h * 0.48, barW: w * 0.40 },
    { y: h * 0.68, barW: w * 0.46 },
  ];
  const boxSize = w * 0.12;
  const startX = w * 0.20;
  const barH = h * 0.10;
  const gap = w * 0.06;

  const fillRect = (x0, y0, rw, rh) => {
    for (let y = y0; y < y0 + rh; y++) {
      for (let x = x0; x < x0 + rw; x++) setPixel(Math.round(x), Math.round(y), 255, 255, 255, 255);
    }
  };

  for (const row of rows) {
    fillRect(startX, row.y, boxSize, boxSize);
    fillRect(startX + boxSize + gap, row.y + (boxSize - barH) / 2, row.barW, barH);
  }
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const png = makePng(size, draw);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`generated icon-${size}.png`);
}
