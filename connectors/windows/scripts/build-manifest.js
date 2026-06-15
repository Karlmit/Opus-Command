#!/usr/bin/env node
// Emits the auto-update manifest published alongside the Windows installer as a
// GitHub release asset. The Electron app reads this to decide whether a newer
// connector version is available. See electron-main.js (findUpdateRelease).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const distDir = path.join(repoRoot, 'dist');
const { version } = require(path.join(root, 'package.json'));

const manifest = {
  product: 'opus-windows-connector',
  version,
  installer: `OpusConnector-Setup-${version}.exe`,
  notes: process.env.OPUS_CONNECTOR_RELEASE_NOTES || '',
  publishedAt: new Date().toISOString(),
};

fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'opus-windows-connector.json');
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(outPath);
