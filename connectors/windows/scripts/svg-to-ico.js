const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'assets', 'mark-dark.svg');
const icoPath = path.join(root, 'assets', 'mark-dark.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const svg = fs.readFileSync(svgPath);
  const pngs = await Promise.all(sizes.map(size => (
    sharp(svg)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toBuffer()
  )));
  const ico = await pngToIco(pngs);
  fs.writeFileSync(icoPath, ico);
  console.log(`Wrote ${icoPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
