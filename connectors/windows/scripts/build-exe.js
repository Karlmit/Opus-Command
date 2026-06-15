#!/usr/bin/env node
// Packages the Electron app into dist/OpusConnector-win32-x64. Done in Node
// (not a shell one-liner) so the ignore pattern is a real RegExp instead of a
// shell-quoted string — single quotes around the pattern are taken literally by
// Windows cmd and corrupt the regex.
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = path.resolve(root, '..', '..', 'dist');

const packagerModule = require('@electron/packager');
const packager = packagerModule.packager || packagerModule.default || packagerModule;

// Build-time-only dependencies that must not be bundled into the packaged app.
const IGNORE = /(^|[\\/])node_modules[\\/](electron|@electron|electron-packager|pkg|sharp|png-to-ico)([\\/]|$)/;

async function main() {
  // Regenerate the icon first.
  execFileSync(process.execPath, [path.join(root, 'scripts', 'svg-to-ico.js')], {
    stdio: 'inherit',
    cwd: root,
  });

  const appPaths = await packager({
    dir: root,
    name: 'OpusConnector',
    platform: 'win32',
    arch: 'x64',
    out: distDir,
    overwrite: true,
    icon: path.join(root, 'assets', 'mark-dark.ico'),
    ignore: IGNORE,
  });
  console.log(`Packaged ${appPaths.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
