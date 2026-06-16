const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'assets', 'app-icon.png');
const icoPath = path.join(root, 'assets', 'app-icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const src = fs.readFileSync(srcPath);
  const pngs = await Promise.all(sizes.map(size => (
    sharp(src)
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
