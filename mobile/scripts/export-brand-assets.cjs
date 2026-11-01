// Reuses the committed torii vector; requires a local Sharp installation, never downloads one.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.env.RELO_SHARP_MODULE || 'sharp');
const assets = path.resolve(__dirname, '../assets');
const source = fs.readFileSync(path.join(assets, 'brand-mark.svg'), 'utf8');
const background = '#376347';
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
async function exportSvg(name, svg, size) {
  let image = sharp(Buffer.from(svg)).resize(size, size);
  if (['icon.png', 'android-icon-background.png', 'favicon.png'].includes(name)) image = image.removeAlpha();
  const buffer = await image.png().toBuffer();
  fs.writeFileSync(path.join(assets, name), buffer);
  return { file: name, width: size, height: size, sha256: digest(buffer) };
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
    renderer: 'sharp ' + sharp.versions.sharp,
    method: 'Deterministic SVG raster export. No image generation or raster retouching.',
    background, adaptiveForegroundScale: 0.8, outputs,
  }, null, 2) + '\n');
  console.log('Exported ' + outputs.length + ' branded assets.');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
