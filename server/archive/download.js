// ============================================================================
// F1DB ARCHIVE DOWNLOADER
//
// Every statistic this dashboard shows comes from F1DB (https://github.com/f1db/f1db),
// an open database of every Formula 1 session since 1950. They publish a SQLite build
// as a GitHub release asset after each race weekend.
//
// This module keeps a local copy fresh:
//   1. ask GitHub for the latest release tag
//   2. if it differs from what's on disk, download the ~15 MB zip
//   3. unzip it (by hand — see unzipSingleFile) to a ~73 MB .db file
//   4. atomically swap it into place and tell the caller to reopen
//
// The archive lives on a mounted volume, NOT in the container image, so it survives
// Watchtower updates and refreshes without a rebuild.
//
// Nothing here ever throws at the caller. A failed download leaves the previous
// archive in place; the very first failure leaves the site in a "downloading"
// state that the UI renders explicitly rather than showing an empty dashboard.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { log } from '../logger.js';

const RELEASE_API = 'https://api.github.com/repos/f1db/f1db/releases/latest';
const ASSET_NAME = 'f1db-sqlite.zip';
// GitHub rejects API requests with no User-Agent, so identify ourselves politely.
const USER_AGENT = 'pit-wall/1.0 (personal F1 dashboard; +https://github.com/jamisonhill/pit-wall)';
const VERSION_FILE = 'archive-version.json';

/**
 * Live status, surfaced at /healthz and /api/archive so the dashboard can say
 * "still downloading" instead of rendering a blank page.
 * @type {{state:'missing'|'downloading'|'ready'|'error', version:string|null,
 *         dbPath:string|null, downloadedAt:string|null, error:string|null,
 *         progress:number|null}}
 */
export const archiveStatus = {
  state: 'missing',
  version: null,
  dbPath: null,
  downloadedAt: null,
  error: null,
  progress: null, // 0..1 while downloading, null otherwise
};

// ---- Version bookkeeping ----------------------------------------------------

/** What's already on disk, or null if this is a first run. */
function readVersion(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, VERSION_FILE), 'utf8');
    const meta = JSON.parse(raw);
    // Trust the file only if the database it names is actually still there.
    if (meta?.dbPath && fs.existsSync(meta.dbPath)) return meta;
  } catch { /* absent or corrupt — treat as a first run */ }
  return null;
}

function writeVersion(dir, meta) {
  fs.writeFileSync(path.join(dir, VERSION_FILE), JSON.stringify(meta, null, 2));
}

// ---- ZIP reading, without a dependency --------------------------------------

/**
 * Extract the single file with the given extension from a ZIP buffer.
 *
 * We read the ZIP's *central directory* (the index at the end of the file) rather
 * than the per-entry local headers. Local headers are allowed to omit the entry
 * sizes when a zip is written as a stream — the central directory always has them.
 *
 * Only the two compression methods a real ZIP uses are handled: 0 (stored) and
 * 8 (deflate). Anything else means the release format changed, which is worth a
 * loud error rather than silent corruption.
 *
 * @param {Buffer} buf  the whole .zip file
 * @param {string} ext  e.g. '.db'
 * @returns {Buffer} the decompressed file contents
 */
export function unzipSingleFile(buf, ext) {
  // The End Of Central Directory record sits at the very end, but a trailing
  // comment can push it back by up to 64 KB — so scan backwards for its signature.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // offset of the first central-directory entry

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    if (name.toLowerCase().endsWith(ext)) {
      // Jump to the local file header to find where the compressed bytes start.
      // Its own name/extra field lengths can differ from the central directory's.
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('corrupt zip local header');
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const body = buf.subarray(start, start + compressedSize);

      if (method === 0) return Buffer.from(body);            // stored, no compression
      if (method === 8) return zlib.inflateRawSync(body);    // deflate
      throw new Error(`unsupported zip compression method ${method} for ${name}`);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`no ${ext} file inside the archive`);
}

// ---- Download ---------------------------------------------------------------

/** Ask GitHub what the newest F1DB release is. Returns null if unreachable. */
async function latestRelease() {
  const res = await fetch(RELEASE_API, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub release lookup returned HTTP ${res.status}`);
  const json = await res.json();
  const asset = (json.assets ?? []).find((a) => a.name === ASSET_NAME);
  if (!asset) throw new Error(`release ${json.tag_name} has no ${ASSET_NAME} asset`);
  return { version: json.tag_name, url: asset.browser_download_url, bytes: asset.size };
}

/** Stream the zip into memory, reporting progress as we go. */
async function downloadZip(url, expectedBytes) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(10 * 60_000), // a slow NAS uplink is still a valid one
  });
  if (!res.ok) throw new Error(`archive download returned HTTP ${res.status}`);

  const chunks = [];
  let received = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (expectedBytes) archiveStatus.progress = Math.min(1, received / expectedBytes);
  }
  return Buffer.concat(chunks);
}

// ---- The one function the server calls --------------------------------------

let inFlight = null; // collapses concurrent calls (boot + refresh timer) into one download

/**
 * Make sure a usable archive is on disk, downloading a newer release if there is one.
 * Safe to call repeatedly. Resolves once the archive is ready (or left unchanged).
 *
 * @param {{dir:string, autoUpdate:boolean, onReady?:(dbPath:string, version:string)=>void}} opts
 */
export async function ensureArchive({ dir, autoUpdate = true, onReady }) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const existing = readVersion(dir);

    if (existing) {
      // Publish what we already have straight away — the site works while we check
      // for a newer release in the background.
      Object.assign(archiveStatus, {
        state: 'ready',
        version: existing.version,
        dbPath: existing.dbPath,
        downloadedAt: existing.downloadedAt,
        error: null,
        progress: null,
      });
      onReady?.(existing.dbPath, existing.version);
      if (!autoUpdate) return archiveStatus;
    }

    let release;
    try {
      release = await latestRelease();
    } catch (err) {
      // Offline with an archive already on disk is a non-event; offline without one
      // is why the dashboard has an explicit "archive unavailable" state.
      log.warn('Could not check for a newer F1DB release', { error: String(err) });
      if (!existing) Object.assign(archiveStatus, { state: 'error', error: String(err) });
      return archiveStatus;
    }

    if (existing?.version === release.version) {
      log.info('F1DB archive is current', { version: release.version });
      return archiveStatus;
    }

    log.info('Downloading F1DB archive', {
      version: release.version,
      from: existing?.version ?? 'none',
      megabytes: Math.round(release.bytes / 1e6),
    });
    if (!existing) Object.assign(archiveStatus, { state: 'downloading', progress: 0 });

    try {
      const zip = await downloadZip(release.url, release.bytes);
      const db = unzipSingleFile(zip, '.db');

      // Write to a temp name first, then rename. Rename is atomic on the same
      // filesystem, so a reader never sees a half-written database.
      const finalPath = path.join(dir, `f1db-${release.version}.db`);
      const tmpPath = `${finalPath}.tmp`;
      fs.writeFileSync(tmpPath, db);
      fs.renameSync(tmpPath, finalPath);

      const meta = {
        version: release.version,
        dbPath: finalPath,
        downloadedAt: new Date().toISOString(),
        sizeBytes: db.length,
      };
      writeVersion(dir, meta);
      Object.assign(archiveStatus, { ...meta, state: 'ready', error: null, progress: null });
      log.info('F1DB archive ready', { version: meta.version, megabytes: Math.round(db.length / 1e6) });
      onReady?.(finalPath, release.version);

      // Reclaim the space the previous release was using.
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.db') && path.join(dir, name) !== finalPath) {
          try { fs.unlinkSync(path.join(dir, name)); } catch { /* in use; next boot gets it */ }
        }
      }
    } catch (err) {
      log.error('F1DB archive download failed', { error: String(err) });
      // Keep serving the old archive if we have one; only a first-run failure is fatal.
      if (!existing) Object.assign(archiveStatus, { state: 'error', error: String(err), progress: null });
      else Object.assign(archiveStatus, { progress: null });
    }
    return archiveStatus;
  })().finally(() => { inFlight = null; });

  return inFlight;
}
