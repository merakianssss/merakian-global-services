// scripts/optimize-images.mjs
// One-time image optimization for og-image.png and favicon.png
// Uses sharp (transitive dep of astro)
// Run: node scripts/optimize-images.mjs

import sharp from 'sharp';
import { statSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = 'public';

async function optimizeOgImage() {
  const src = join(PUBLIC, 'og-image.png');
  const origSize = statSync(src).size;
  console.log(`og-image.png before: ${(origSize/1024).toFixed(1)} KB`);

  // Resize to standard OG dimension (1200x630) and optimize with palette mode
  const buf = await sharp(src)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .png({ quality: 85, compressionLevel: 9, effort: 10, palette: true })
    .toBuffer();
  const newSize = buf.length;
  writeFileSync(src, buf);
  console.log(`og-image.png after:  ${(newSize/1024).toFixed(1)} KB (${((1-newSize/origSize)*100).toFixed(1)}% smaller)`);
}

async function optimizeFavicon() {
  const src = join(PUBLIC, 'favicon.png');
  const origSize = statSync(src).size;
  console.log(`favicon.png before: ${(origSize/1024).toFixed(1)} KB`);

  // Resize to 512x512 (max needed for favicon) and optimize
  const buf = await sharp(src)
    .resize(512, 512, { fit: 'cover' })
    .png({ quality: 90, compressionLevel: 9, effort: 10, palette: true })
    .toBuffer();
  const newSize = buf.length;
  writeFileSync(src, buf);
  console.log(`favicon.png after:  ${(newSize/1024).toFixed(1)} KB (${((1-newSize/origSize)*100).toFixed(1)}% smaller)`);
}

async function main() {
  // Back up originals FIRST
  try {
    copyFileSync(join(PUBLIC, 'og-image.png'), join(PUBLIC, 'og-image.png.original'));
    copyFileSync(join(PUBLIC, 'favicon.png'), join(PUBLIC, 'favicon.png.original'));
    console.log('Originals backed up to *.original files.\n');
  } catch (e) {
    console.log('Backup note:', e.message);
  }

  await optimizeOgImage();
  console.log('');
  await optimizeFavicon();
  console.log('\nDone. Original files preserved as *.original.');
}

main().catch((e) => { console.error(e); process.exit(1); });
