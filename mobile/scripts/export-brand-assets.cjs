// Reuses the committed torii vector; requires a local Sharp installation, never downloads one.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Metadata-only repair needs only Node; a fresh raster export also needs the existing local Sharp.
const metadataOnly = process.argv.includes('--embed-origin');
const sharp = metadataOnly ? null : require(process.env.RELO_SHARP_MODULE || 'sharp');
const assets = path.resolve(__dirname, '../assets');
const source = fs.readFileSync(path.join(assets, 'brand-mark.svg'), 'utf8');
const background = '#376347';
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const renderer = metadataOnly
  ? JSON.parse(fs.readFileSync(path.join(assets, 'brand-assets.json'), 'utf8')).renderer
  : 'sharp ' + sharp.versions.sharp;
const origin = 'Origin: Deterministic SVG export from mobile/assets/brand-mark.svg using '
  + renderer.replace(/^sharp /, 'Sharp ') + '; source SHA-256 ' + digest(source)
  + '. Geometry inherited from marketing/icon/icon-master.svg. Export script: mobile/scripts/export-brand-assets.cjs.'
  + ' No AI image generation or raster retouching.';
const originKeyword = Buffer.from('impeccable:prompt\0', 'latin1');

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Impeccable's PNG format is a tEXt chunk, keyword "impeccable:prompt", immediately before IEND.
// Work on the PNG container directly: preserve every other chunk byte-for-byte, including IDAT.
function withOrigin(png, text = null) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (!png.subarray(0, 8).equals(signature)) throw new Error('Not a PNG');
  const chunks = [png.subarray(0, 8)];
  let ended = false;
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG chunk');
    const length = png.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > png.length) throw new Error('Truncated PNG data');
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, end - 4);
    if (crc32(png.subarray(offset + 4, end - 4)) !== png.readUInt32BE(end - 4)) throw new Error('Invalid PNG CRC');
    if (type === 'IEND') {
      if (end !== png.length) throw new Error('Unexpected bytes after PNG end');
      if (text !== null) {
        const payload = Buffer.concat([Buffer.from('tEXt'), originKeyword, Buffer.from(text, 'latin1')]);
        const chunk = Buffer.alloc(payload.length + 8);
        chunk.writeUInt32BE(payload.length - 4, 0);
        payload.copy(chunk, 4);
        chunk.writeUInt32BE(crc32(payload), chunk.length - 4);
        chunks.push(chunk);
      }
      ended = true;
    }
    if (!(type === 'tEXt' && data.subarray(0, originKeyword.length).equals(originKeyword))) {
      chunks.push(png.subarray(offset, end));
    }
    offset = end;
  }
  if (!ended) throw new Error('Missing PNG end');
  return Buffer.concat(chunks);
}

async function exportSvg(name, svg, size) {
  let raster;
  if (metadataOnly) raster = fs.readFileSync(path.join(assets, name));
  else {
    let image = sharp(Buffer.from(svg)).resize(size, size);
    if (['icon.png', 'android-icon-background.png', 'favicon.png'].includes(name)) image = image.removeAlpha();
    raster = await image.png().toBuffer();
  }
  const buffer = withOrigin(raster, origin);
  fs.writeFileSync(path.join(assets, name), buffer);
  return { file: name, width: size, height: size, sha256: digest(buffer), pngWithoutOriginSha256: digest(withOrigin(buffer)) };
}
(async () => {
  const body = source.slice(source.indexOf('<svg'));
  const full = body.replace(/(<svg[^>]*>)/, '$1<rect width="1024" height="1024" fill="' + background + '"/>');
  // Keep all meaningful artwork inside the adaptive icon's central circular safe zone.
  const adaptive = body.replace(/(<svg[^>]*>)/, '$1<g transform="translate(102.4 102.4) scale(0.8)">').replace('</svg>', '</g></svg>');
  const mono = adaptive.replaceAll('#D7B772', '#FFFFFF');
  const splash = body.replaceAll('#FFFFFF', '#376347').replaceAll('#D7B772', '#896421');
  const blank = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="' + background + '"/></svg>';
  const outputs = [];
  for (const [name, svg, size] of [
    ['icon.png', full, 1024],
    ['android-icon-foreground.png', adaptive, 1024],
    ['android-icon-background.png', blank, 1024],
    ['android-icon-monochrome.png', mono, 1024],
    ['splash-icon.png', splash, 1024],
    ['favicon.png', full, 64],
  ]) outputs.push(await exportSvg(name, svg, size));
  fs.writeFileSync(path.join(assets, 'brand-assets.json'), JSON.stringify({
    source: 'brand-mark.svg', sourceSha256: digest(source),
    inheritedGeometry: 'marketing/icon/icon-master.svg',
    renderer,
    method: 'Deterministic SVG raster export. No image generation or raster retouching.',
    provenance: { chunk: 'tEXt', keyword: 'impeccable:prompt', origin },
    background, adaptiveForegroundScale: 0.8, outputs,
  }, null, 2) + '\n');
  console.log('Exported ' + outputs.length + ' branded assets.');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
