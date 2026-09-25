/**
 * In-place injection of hardcoded-tooltip translations into the VENDOR behavior XMLs.
 *
 * Why in-place for PMDG/TFDi (2026-09-25 in-game verdict): their behavior files are loaded
 * through package-internal resolution (PMDG: <IncludeBase RelativeFile=..> inside the
 * attachments system; TFDi: package-scoped behavior includes), so cross-package shadowing
 * never reaches them. iFly keeps the shadow approach — its model-level behavior file IS
 * resolved through the VFS and the standalone overlay works.
 *
 * Backup policy (user directive): only the files actually modified are backed up, on first
 * touch, to .local-backups/vendor-injection/<pkg>/ — never the whole package, and pristine
 * bytes are never overwritten by later runs.
 *
 * Integrity: the current file must hash-match the recorded vendor base (pristine) or the
 * backup (already injected) — anything else (vendor update) is refused until re-extracted.
 *
 *   node tools/tooltip-zh/inject-hardcoded.mjs <pmdg-737|tfdi-md11> [--clean] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const NAME = process.argv[2];
const CLEAN = process.argv.includes('--clean');
const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '../..');
const LAB = path.join(ROOT, '.local-lab/tooltip');
const TARGETS = {
  'pmdg-737': 'F:/games/community/Community2024/pmdg-aircraft-737',
  'pmdg-738': 'F:/games/community/Community2024/pmdg-aircraft-738',
  'tfdi-md11': 'F:/games/community/Community/tfdidesign-aircraft-md11',
};
const FORCE = process.argv.includes('--force');
if (!NAME || !TARGETS[NAME]) {
  console.error('usage: inject-hardcoded.mjs <pmdg-737|pmdg-738|tfdi-md11> [--clean] [--dry] [--force]');
  process.exit(2);
}
const VENDOR = TARGETS[NAME];
const PKGNAME = path.basename(VENDOR);
const BACKUP = path.join(ROOT, '.local-backups/vendor-injection', PKGNAME);
const MANIFEST = path.join(BACKUP, 'manifest.json');
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const corpus = JSON.parse(fs.readFileSync(path.join(LAB, `hardcoded-${NAME}.json`), 'utf8'));
const { dict } = JSON.parse(fs.readFileSync(path.join(LAB, `dict-hardcoded-${NAME}.json`), 'utf8'));
// base hashes: separate file when deploy-hardcoded ran, else the extraction-time record
let base = {};
const baseFile = path.join(LAB, `hardcoded-${NAME}.base.json`);
if (fs.existsSync(baseFile)) base = JSON.parse(fs.readFileSync(baseFile, 'utf8')).vendorBase ?? {};
else base = corpus.base ?? {};
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const saveManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));

const RE = /(<tooltipid>)([^<]*)(<\/tooltipid>)/gi;

if (CLEAN) {
  if (!fs.existsSync(MANIFEST)) {
    console.log(`# no injection manifest for ${PKGNAME} — nothing to restore`);
    process.exit(0);
  }
  let n = 0;
  for (const [rel, rec] of Object.entries(manifest)) {
    if (rec.injected !== true) continue;
    const abs = path.join(VENDOR, rel.replace(/\//g, path.sep));
    fs.copyFileSync(path.join(BACKUP, rel), abs);
    console.log(`  restored: ${rel}`);
    n++;
  }
  console.log(`# ${PKGNAME} reverted (${n} files)`);
  process.exit(0);
}

let injected = 0;
let skipped = 0;
for (const [rel, expected] of Object.entries(corpus.files)) {
  const abs = path.join(VENDOR, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) throw new Error(`vendor file missing: ${rel}`);
  const rec = manifest[rel];
  const cur = sha256(abs);
  const baseHash = base[rel]?.sha256;
  const backupAbs = path.join(BACKUP, rel);
  const hasBackup = rec && fs.existsSync(backupAbs);

  if (hasBackup && !FORCE && cur === sha256(backupAbs)) {
    skipped++;
    continue; // restore-state == current state: nothing injected
  }
  if (hasBackup && !FORCE && cur === rec.injectedSha256) {
    skipped++;
    continue; // already injected with the current dictionary
  }

  // --force re-injection applies the NEW dictionary to the PRISTINE backup, never on top
  // of a previous injection (the count gate can only match against the original English)
  const reInject = hasBackup && rec.injected;
  if (reInject && !FORCE && baseHash && cur !== baseHash && cur !== rec.injectedSha256) {
    throw new Error(`${rel}: file changed since base extraction (vendor update?) — re-extract first`);
  }
  const sourceAbs = reInject ? backupAbs : abs;
  if (!reInject && baseHash && cur !== baseHash) {
    throw new Error(`${rel}: file changed since base extraction (vendor update?) — re-extract first`);
  }
  const raw = fs.readFileSync(sourceAbs, 'utf8');
  let count = 0;
  const out = raw.replace(RE, (whole, open, inner, close) => {
    const zh = dict[inner.trim()];
    if (zh === undefined) return whole;
    count++;
    return `${open}${zh}${close}`;
  });
  if (count !== expected) throw new Error(`${rel}: expected ${expected} handled tooltips, got ${count} — drift`);

  if (DRY) {
    console.log(`  would inject ${count} tooltips: ${rel}`);
    continue;
  }
  if (!rec) {
    // first touch: record pristine bytes once, never overwritten
    fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
    fs.copyFileSync(abs, backupAbs);
    manifest[rel] = { original: cur, bytes: fs.statSync(abs).size, backedUpAt: new Date().toISOString(), injected: true };
  } else {
    rec.injected = true;
  }
  fs.writeFileSync(abs, out);
  manifest[rel].injectedSha256 = sha256(abs);
  saveManifest();
  injected++;
  console.log(`  injected ${count} tooltips: ${rel}`);
}
console.log(`# ${PKGNAME}: injected ${injected} files (${skipped} already up-to-date)  [NOT PUBLISHED]`);
