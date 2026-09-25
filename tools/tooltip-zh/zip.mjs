/**
 * Minimal read-only ZIP central-directory reader (no deps).
 * Windows `tar.exe` is not on PATH in this shell and msys `tar` cannot read ZIP,
 * so patch archives are inspected through this instead.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;

export function readZipEntries(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  const scanFrom = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`no EOCD in ${file}`);

  let cdOffset = buf.readUInt32LE(eocd + 16);
  let total = buf.readUInt16LE(eocd + 10);

  // ZIP64 wrapper
  if (cdOffset === 0xffffffff || total === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD64_LOC_SIG) {
        const z64 = Number(buf.readBigUInt64LE(i + 8));
        if (buf.readUInt32LE(z64) === EOCD64_SIG) {
          total = Number(buf.readBigUInt64LE(z64 + 32));
          cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
        }
        break;
      }
    }
  }

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== CD_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeader = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, uncompSize, localHeader, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one stored/deflated entry. */
export function readZipEntry(file, entry) {
  const buf = fs.readFileSync(file);
  const lh = entry.localHeader;
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(raw);
  return zlib.inflateRawSync(raw);
}

export function readZipText(file, predicate) {
  const entry = readZipEntries(file).find((e) => !e.isDir && predicate(e.name));
  if (!entry) return null;
  return { entry, text: readZipEntry(file, entry).toString('utf8') };
}
