import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const mark = JSON.parse(await fs.readFile(path.join(root, 'lib/brand-mark.json'), 'utf8'));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}" width="32" height="32"><rect width="24" height="24" rx="4" fill="${mark.ground}"/><g fill="none" stroke="${mark.ink}" stroke-linecap="square">${mark.paths.map(p => `<path d="${p.d}" stroke-width="${p.strokeWidth}"/>`).join('')}</g></svg>\n`;
const target = path.join(root, 'public/brand');
if (process.argv.includes('--check')) {
  for (const file of [`brand/${mark.version}.svg`, 'icon.svg']) {
    if (await fs.readFile(path.join(root, 'public', file), 'utf8') !== svg) throw Error(`Brand geometry drift: ${file}`);
  }
  const png = await fs.readFile(path.join(target, `${mark.version}-32.png`));
  if (png.readUInt32BE(16) !== 32 || png.readUInt32BE(20) !== 32) throw Error('Invalid tab raster');
  const ico = await fs.readFile(path.join(target, `${mark.version}.ico`));
  if (ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) !== 3) throw Error('Invalid icon directory');
  if (!ico.equals(await fs.readFile(path.join(root, 'public/favicon.ico')))) throw Error('Fallback icon drift');
  console.log('Canonical brand assets verified');
} else {
  // Next already pins sharp in the lockfile; no network or image model is involved.
  const nextRequire = createRequire(import.meta.resolve('next/package.json'));
  const { default: sharp } = await import(pathToFileURL(nextRequire.resolve('sharp')).href);
  const sizes = [16, 32, 48];
  const rasters = await Promise.all(sizes.map(size => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  rasters.forEach((png, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index]; header[entry + 1] = sizes[index];
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  const ico = Buffer.concat([header, ...rasters]);
  await fs.mkdir(target, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(target, `${mark.version}.svg`), svg),
    fs.writeFile(path.join(root, 'public/icon.svg'), svg),
    fs.writeFile(path.join(target, `${mark.version}-32.png`), rasters[1]),
    fs.writeFile(path.join(target, `${mark.version}.ico`), ico),
    fs.writeFile(path.join(root, 'public/favicon.ico'), ico),
  ]);
  console.log('Canonical SVG, 32px PNG and 16/32/48px ICO written');
}
