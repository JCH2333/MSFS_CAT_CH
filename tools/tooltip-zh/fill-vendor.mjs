/**
 * Production vendor-channel filler for cockpit-tooltip (悬浮提示) localization.
 *
 * Channel proven 2026-09-25: MSFS2024 only reads locPak files INSIDE the aircraft's own
 * package (probe 【探针V】 in fnx-aircraft-320 rendered; every separate probe package in
 * rounds 1-3 stayed silent; FBW A380X renders its own zh-CN.locPak).
 *
 * What it does per vendor package:
 *   - merges the authored dictionary OVER the vendor's existing zh locPak (all vendor
 *     non-tooltip keys — checklists etc. — are carried through untouched);
 *   - writes the file back under the vendor's own name/casing, or creates zh-CN.locPak
 *     when the vendor has none;
 *   - updates the layout.json entry size in place (text splice, 18-digit FILETIME kept);
 *     hash fields (marketplace packages) are left as-is — the sim tolerates size drift;
 *   - BACKUP POLICY (user directive): only the files actually touched are backed up, never
 *     the whole package. First touch records the pristine bytes under
 *     .local-backups/vendor-injection/<pkg>/ and later runs never overwrite that record.
 *
 *   node tools/tooltip-zh/fill-vendor.mjs <vendorPkg> --dict <dict.json>
 *        [--assume-created <file>] [--check] [--clean]
 *
 * --clean restores every touched file from the backup manifest (created files are removed,
 * modified files restored byte-identically), returning the vendor package to its
 * pre-injection state.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { filetime18, buildLocPakJson } from './pack.mjs';

const argv = process.argv.slice(2);
const PKG = path.resolve(argv.find((a) => !a.startsWith('--')) ?? '');
const DICT = argv.includes('--dict') ? argv[argv.indexOf('--dict') + 1] : null;
const CHECK = argv.includes('--check');
const CLEAN = argv.includes('--clean');
const ASSUME_CREATED = argv.includes('--assume-created') ? argv[argv.indexOf('--assume-created') + 1] : null;
const BACKUP_ROOT = path.resolve(import.meta.dirname, '../../.local-backups/vendor-injection');

if (!PKG || (!DICT && !CHECK && !CLEAN) || !fs.existsSync(path.join(PKG, 'layout.json'))) {
  console.error('usage: fill-vendor.mjs <vendorPkg> --dict <dict.json> [--assume-created <file>] [--check] [--clean]');
  process.exit(2);
}
const PKGNAME = path.basename(PKG);
const BACKUP = path.join(BACKUP_ROOT, PKGNAME);
const MANIFEST = path.join(BACKUP, 'manifest.json');
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const loadManifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {});
const saveManifest = (m) => {
  fs.mkdirSync(BACKUP, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1));
};
/** First-touch backup: pristine bytes are recorded once and never overwritten. */
const backupOnce = (abs, rel, created = false) => {
  const m = loadManifest();
  if (m[rel]) return m;
  const dst = path.join(BACKUP, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (created) m[rel] = { original: null, recordedAt: new Date().toISOString() };
  else {
    fs.copyFileSync(abs, dst);
    m[rel] = { original: sha256(abs), bytes: fs.statSync(abs).size, backedUpAt: new Date().toISOString() };
  }
  saveManifest(m);
  console.log(`  backup${created ? ' (created by us, clean will delete)' : ''}: ${rel}`);
  return m;
};

// hash-tolerant layout entry scanner: { "path": "..", "size": N, "date": N /* , "hash": N */ }
function scanEntry(text, relPathLower) {
  const re = /\{[^{}]*?"path"\s*:\s*"([^"]*)"[^{}]*?"size"\s*:\s*(\d+)[^{}]*?"date"\s*:\s*(\d{18})[^{}]*?\}/g;
  for (const m of text.matchAll(re)) {
    if (m[1].toLowerCase() === relPathLower) return { raw: m[0], path: m[1], size: +m[2], date: m[3] };
  }
  return null;
}
function updateEntrySize(text, relPathLower, newSize) {
  const hit = scanEntry(text, relPathLower);
  if (!hit) return null;
  const patched = hit.raw.replace(/("size"\s*:\s*)\d+/, `$1${newSize}`);
  return { text: text.replace(hit.raw, patched), from: hit.size, to: newSize };
}
function insertEntry(text, relPath, size, date) {
  const anchor = text.match(/("content"\s*:\s*\[)/);
  if (!anchor) throw new Error('layout.json has no "content": [ anchor');
  const ind = (/\n(\s*)\{/.exec(text.slice(anchor.index)) ?? [, '    '])[1];
  const block = `${ind}{\n${ind}    "path": ${JSON.stringify(relPath)},\n${ind}    "size": ${size},\n${ind}    "date": ${date}\n${ind}},`;
  return { text: text.replace(anchor[1], `${anchor[1]}\n${block}`), inserted: true };
}

const findZh = () =>
  fs.readdirSync(PKG).filter((f) => /^zh-cn\.locpak$/i.test(f) && fs.statSync(path.join(PKG, f)).isFile());

// ---- clean ---------------------------------------------------------------------
if (CLEAN) {
  const m = loadManifest();
  if (!Object.keys(m).length) {
    console.log(`# no backup manifest for ${PKGNAME} — nothing to restore`);
    process.exit(0);
  }
  for (const [rel, rec] of Object.entries(m)) {
    const abs = path.join(PKG, rel);
    if (rec.original === null) {
      if (fs.existsSync(abs)) {
        fs.rmSync(abs);
        console.log(`  removed (was created by us): ${rel}`);
      }
    } else if (fs.existsSync(abs)) {
      fs.copyFileSync(path.join(BACKUP, rel), abs);
      console.log(`  restored: ${rel}`);
    }
  }
  console.log(`# ${PKGNAME} reverted to pre-injection state`);
  process.exit(0);
}

// ---- locate / load --------------------------------------------------------------
const dictRaw = CHECK && !DICT ? null : JSON.parse(fs.readFileSync(DICT, 'utf8'));
const dict = dictRaw ? (dictRaw.dict ?? dictRaw) : null;
const existing = findZh();
const fileName = existing[0] ?? 'zh-CN.locPak';
const relLower = fileName.toLowerCase();
const absTarget = path.join(PKG, fileName);

let seed = {};
if (existing.length) seed = JSON.parse(fs.readFileSync(absTarget, 'utf8')).LocalisationPackage.Strings;

if (CHECK) {
  const entry = scanEntry(fs.readFileSync(path.join(PKG, 'layout.json'), 'utf8'), relLower);
  const real = fs.statSync(absTarget).size;
  const cjk = Object.values(seed).filter((v) => /[\u3400-\u9fff]/.test(v)).length;
  console.log(`# ${PKGNAME}: ${fileName} keys=${Object.keys(seed).length} cjk=${cjk} layout=${entry ? `size ${entry.size}` : 'NOT LISTED'} disk=${real} ${entry && entry.size === real ? 'SIZE-OK' : 'SIZE-DRIFT'}`);
  process.exit(0);
}

// ---- merge ----------------------------------------------------------------------
const payload = {};
const problems = [];
for (const [k, v] of Object.entries(dict)) {
  const val = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!val) problems.push(`empty value: ${k}`);
  payload[k] = val;
}
if (problems.length) {
  console.error(`REFUSED: ${problems.length} dictionary problems (first 5):\n  ` + problems.slice(0, 5).join('\n  '));
  process.exit(1);
}
const merged = { ...seed, ...payload };
const json = buildLocPakJson('zh-CN', merged);

// ---- write ----------------------------------------------------------------------
backupOnce(absTarget, fileName, existing.length === 0 || fileName === ASSUME_CREATED);
fs.writeFileSync(absTarget, json);
const size = fs.statSync(absTarget).size;

let layoutText = fs.readFileSync(path.join(PKG, 'layout.json'), 'utf8');
backupOnce(path.join(PKG, 'layout.json'), 'layout.json');
const hit = scanEntry(layoutText, relLower);
if (hit) {
  if (hit.size !== size) {
    const r = updateEntrySize(layoutText, relLower, size);
    layoutText = r.text;
    console.log(`  layout size ${hit.size} -> ${size} (hash field kept as-is if present)`);
  }
} else {
  const r = insertEntry(layoutText, fileName, size, filetime18(fs.statSync(absTarget).mtimeMs));
  layoutText = r.text;
  console.log(`  layout entry inserted for ${fileName}`);
}
fs.writeFileSync(path.join(PKG, 'layout.json'), layoutText);

// ---- validate -------------------------------------------------------------------
const after = scanEntry(layoutText, relLower);
const reparsed = JSON.parse(fs.readFileSync(absTarget, 'utf8')).LocalisationPackage.Strings;
const errors = [];
if (!after) errors.push('entry missing after write');
else if (after.size !== size) errors.push(`layout size ${after.size} != disk ${size}`);
if (Object.keys(reparsed).length !== Object.keys(merged).length) errors.push('key count drift after re-read');
const textCount = (layoutText.match(/\{[^{}]*?"path"/g) ?? []).length;
const jsonCount = JSON.parse(layoutText).content.length;
if (textCount !== jsonCount) errors.push(`layout structure drift: text ${textCount} vs json ${jsonCount}`);
if (errors.length) {
  console.error('REFUSED RESULT — restoring:\n  ' + errors.join('\n  '));
  // restore from the just-made backups where possible
  const m = loadManifest();
  if (m[fileName]?.original !== null && existing.length) fs.copyFileSync(path.join(BACKUP, fileName), absTarget);
  else if (m[fileName]?.original === null) fs.rmSync(absTarget, { force: true });
  fs.copyFileSync(path.join(BACKUP, 'layout.json'), path.join(PKG, 'layout.json'));
  process.exit(1);
}
const cjk = Object.values(reparsed).filter((v) => /[\u3400-\u9fff]/.test(v)).length;
console.log(`# ${PKGNAME}: ${fileName} now ${Object.keys(reparsed).length} keys (${cjk} with CJK), ${size} bytes, layout size ok`);
