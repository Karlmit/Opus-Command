const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const ARCHIVE_EXTENSIONS = ['.zip', '.rar'];

function archiveType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ARCHIVE_EXTENSIONS.includes(ext) ? ext.slice(1) : null;
}

class ArchiveError extends Error {
  constructor(message, { status = 500, reason } = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

// Resolve an entry name inside targetDir, refusing anything that escapes it
// (zip-slip / absolute paths).
function safeEntryPath(targetDir, entryName) {
  const targetWithSep = targetDir.endsWith(path.sep) ? targetDir : targetDir + path.sep;
  const resolved = path.resolve(targetDir, entryName.replace(/\\/g, '/'));
  if (resolved !== targetDir && !resolved.startsWith(targetWithSep)) {
    throw new ArchiveError('Archive contains unsafe paths.', { status: 400, reason: 'unsafe-path' });
  }
  return resolved;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

async function extractZip({ archivePath, targetDir, onStart, onEntry, isCancelled }) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const planned = entries.map(entry => ({ entry, dest: safeEntryPath(targetDir, entry.entryName) }));
  onStart(entries.length, entries.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.header.size), 0));

  fs.mkdirSync(targetDir, { recursive: true });
  for (const { entry, dest } of planned) {
    if (isCancelled()) return;
    if (entry.isDirectory) {
      fs.mkdirSync(dest, { recursive: true });
      onEntry(entry.entryName, 0);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, entry.getData());
      onEntry(entry.entryName, entry.header.size);
    }
    await tick();
  }
}

function rarError(err, password) {
  const reason = err && err.reason;
  // RAR4 reports a wrong password as corrupt data.
  if (password && reason === 'ERAR_BAD_DATA') return new ArchiveError('Wrong password, or the archive is damaged.', { status: 400, reason: 'bad-password' });
  if (reason === 'ERAR_MISSING_PASSWORD') return new ArchiveError('This archive is password-protected.', { status: 400, reason: 'password-required' });
  if (reason === 'ERAR_BAD_PASSWORD') return new ArchiveError('Wrong password for this archive.', { status: 400, reason: 'bad-password' });
  if (reason === 'ERAR_EOPEN' && /volume/i.test(err.message || '')) return new ArchiveError('A volume of this multi-part archive is missing.', { status: 400 });
  if (err instanceof ArchiveError) return err;
  return new ArchiveError(err?.message || 'Could not read RAR archive.');
}

async function extractRar({ archivePath, targetDir, password, onStart, onEntry, isCancelled }) {
  // Loaded lazily: it instantiates a WASM module on first use.
  const { createExtractorFromFile } = require('node-unrar-js');
  try {
    const extractor = await createExtractorFromFile({
      filepath: archivePath,
      targetPath: targetDir,
      password: password || undefined,
      // Second line of defence: the extractor joins names onto targetPath.
      filenameTransform: name => path.relative(targetDir, safeEntryPath(targetDir, name)),
    });

    const headers = [...extractor.getFileList().fileHeaders];
    for (const h of headers) safeEntryPath(targetDir, h.name);
    onStart(headers.length, headers.reduce((sum, h) => sum + (h.flags.directory ? 0 : h.unpSize), 0));

    fs.mkdirSync(targetDir, { recursive: true });
    // The files generator extracts one entry per iteration, so progress
    // reflects real work and we can yield between entries.
    const { files } = extractor.extract({ password: password || undefined });
    for (const { fileHeader } of files) {
      if (fileHeader.flags.directory) {
        fs.mkdirSync(safeEntryPath(targetDir, fileHeader.name), { recursive: true });
      }
      onEntry(fileHeader.name, fileHeader.flags.directory ? 0 : fileHeader.unpSize);
      if (isCancelled()) return;
      await tick();
    }
  } catch (err) {
    throw rarError(err, password);
  }
}

/**
 * Extract a .zip or .rar archive into targetDir.
 * onProgress receives { done, total, bytesDone, totalBytes, current }.
 */
async function extractArchive({ archivePath, targetDir, password, onProgress = () => {}, isCancelled = () => false }) {
  const type = archiveType(archivePath);
  if (!type) throw new ArchiveError('Only .zip and .rar archives can be unpacked.', { status: 400 });

  const state = { done: 0, total: 0, bytesDone: 0, totalBytes: 0, current: '' };
  const onStart = (total, totalBytes) => {
    state.total = total;
    state.totalBytes = totalBytes;
    onProgress({ ...state }, true);
  };
  const onEntry = (name, bytes) => {
    state.done += 1;
    state.bytesDone += bytes;
    state.current = name;
    onProgress({ ...state }, state.done === state.total);
  };

  const run = type === 'zip' ? extractZip : extractRar;
  try {
    await run({ archivePath, targetDir, password, onStart, onEntry, isCancelled });
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(err?.message || 'Unpack failed.');
  }
  return state;
}

module.exports = { extractArchive, archiveType, ArchiveError, ARCHIVE_EXTENSIONS };
