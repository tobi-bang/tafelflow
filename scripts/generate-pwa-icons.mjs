import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

function writeSolidPng(size, fileName) {
  const png = new PNG({ width: size, height: size });
  const r = 37;
  const g = 99;
  const b = 235;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const outPath = path.join(publicDir, fileName);
  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log('PWA icon:', outPath);
}

writeSolidPng(192, 'pwa-192.png');
writeSolidPng(512, 'pwa-512.png');
