/**
 * Build the A380 production package = deployed v0.1.11 + cockpit-tooltip zh-CN.locPak,
 * WITHOUT bumping the version (user decision 2026-09-25: merge into the existing local
 * unpublished version). The manifest is not touched at all — its LastUpdate carries the
 * L6 zero-width watermark, which a version/note rewrite would destroy.
 *
 * What this deliberately does and does not do:
 *  - stages from the DEPLOYED Community copy (the build the user actually tests), never
 *    from an older zip — so changes other parallel sessions deploy into v0.1.11 are
 *    preserved: whatever is deployed at merge time is the base this script layers onto;
 *  - refuses to run if the deployed copy already carries a zh-CN.locPak (double-layer);
 *  - drift vs the archived pre-merge v0.1.11 fingerprint is EXPECTED now (parallel
 *    sessions keep extending the EFB dictionaries) — it is listed, not refused;
 *  - runs emit-patch.mjs with --fix-sizes so every staged file's declared size matches
 *    the bytes actually on disk, whatever the parallel sessions changed;
 *  - cross-checks the emitted zh-CN.locPak against the rolled-back v0.1.12 forensic copy
 *    (.local-lab/tooltip/v0112-forensic) — same inputs must give the same 3,139 keys;
 *  - archives the superseded zip+fingerprint to a TIMESTAMPED .local-backups subdir before
 *    writing the new same-versioned zip into local-patches/;
 *  - does NOT deploy anywhere unless --deploy is passed.
 *
 * RE-Run this after parallel sessions land new v0.1.11 content — the merged artifact is
 * only as fresh as the last run.
 *
 *   node tools/tooltip-zh/build-a380-merge.mjs [--deploy]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEPLOYED = 'F:/games/community/Community/zzz-JCH-a380-efb-zh-patch';
const VENDOR = 'F:/games/community/Official2024/Steam/inibuilds-aircraft-a380';
const DICT = path.join(ROOT, '.local-lab/tooltip/dict-ini-a380.json');
const FORENSIC = path.join(ROOT, '.local-lab/tooltip/v0112-forensic/zzz-JCH-a380-efb-zh-patch/zh-CN.locPak');
// baseline = the tooltip-free v0.1.11 fingerprint archived by the first merge run; drift
// against it is what parallel sessions add
const FINGERPRINT = path.join(ROOT, '.local-backups/pre-merge-a380-v0111/msfs-cat-ch-inia380-efb-zh-cn-v0.1.11.fingerprint.json');
const ZIP = path.join(ROOT, 'local-patches/msfs-cat-ch-inia380-efb-zh-cn-v0.1.11.zip');
const BACKUP_DIR = path.join(ROOT, '.local-backups/pre-merge-a380-v0111', new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-'));
const STAGE_ROOT = path.join(ROOT, '.local-lab/tooltip-merge-stage');
const STAGE = path.join(STAGE_ROOT, 'zzz-JCH-a380-efb-zh-patch');
const DEPLOY = process.argv.includes('--deploy');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) n += copyTree(s, d);
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      n++;
    }
  }
  return n;
};

// ---- preconditions ------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(DEPLOYED, 'manifest.json'), 'utf8'));
if (manifest.package_version !== '0.1.11') throw new Error(`deployed package is ${manifest.package_version}, expected 0.1.11`);
if (fs.existsSync(path.join(DEPLOYED, 'zh-CN.locPak'))) throw new Error('deployed package already has a zh-CN.locPak — refusing to double-layer');
{
  const fp = JSON.parse(fs.readFileSync(FINGERPRINT, 'utf8'));
  const drift = [];
  for (const e of fp) {
    const p = path.join(DEPLOYED, e.relativePath.split('/').slice(1).join('/'));
    if (!fs.existsSync(p)) drift.push(`REMOVED ${e.relativePath}`);
    else if (sha256(p) !== e.sha256) drift.push(`CHANGED ${e.relativePath}`);
  }
  if (drift.length) {
    console.log(`# parallel-session drift vs archived v0.1.11 baseline (${drift.length} files) — will be preserved:`);
    for (const d of drift) console.log('#   ' + d);
  } else {
    console.log('# deployed copy matches the archived v0.1.11 baseline (no parallel changes landed yet)');
  }
}
console.log('# preconditions ok: clean v0.1.11 base without tooltip layer');

// ---- stage + emit --------------------------------------------------------------
fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
const copied = copyTree(DEPLOYED, STAGE);
console.log(`# staged ${copied} files -> ${path.relative(ROOT, STAGE)}`);
const out = execFileSync(
  'node',
  [path.join(ROOT, 'tools/tooltip-zh/emit-patch.mjs'), STAGE, '--dict', DICT, '--base', VENDOR, '--fix-sizes'],
  { encoding: 'utf8' }
);
console.log(out.trim().split('\n').map((l) => '  ' + l).join('\n'));

// ---- regression check vs the rolled-back build ----------------------------------
if (fs.existsSync(FORENSIC)) {
  const mine = JSON.parse(fs.readFileSync(path.join(STAGE, 'zh-CN.locPak'), 'utf8')).LocalisationPackage.Strings;
  const prev = JSON.parse(fs.readFileSync(FORENSIC, 'utf8')).LocalisationPackage.Strings;
  const diffs = Object.keys(mine).filter((k) => prev[k] !== mine[k]).concat(Object.keys(prev).filter((k) => !(k in mine)));
  if (Object.keys(mine).length !== Object.keys(prev).length || diffs.length) {
    throw new Error(`emitted locPak differs from the v0.1.12 forensic copy (${diffs.length} keys) — investigate before packaging`);
  }
  console.log(`# locPak regression check: identical to the rolled-back v0.1.12 copy (${Object.keys(mine).length} keys)`);
} else {
  console.log('# locPak regression check: forensic copy absent, skipped');
}

// ---- package --------------------------------------------------------------------
fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const f of [ZIP, FINGERPRINT]) {
  if (fs.existsSync(f)) {
    const dst = path.join(BACKUP_DIR, path.basename(f));
    fs.copyFileSync(f, dst);
    console.log(`# archived superseded artifact -> ${path.relative(ROOT, dst)}`);
  }
}
fs.rmSync(ZIP, { force: true });
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${STAGE}' -DestinationPath '${ZIP}' -Force`],
  { stdio: 'pipe' }
);
const files = [];
const walk = (d, rel) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r);
    else files.push({ relativePath: `zzz-JCH-a380-efb-zh-patch/${r}`, abs: path.join(d, e.name) });
  }
};
walk(STAGE, '');
const fp = files.map((f) => ({ relativePath: f.relativePath, sha256: sha256(f.abs) }));
fs.writeFileSync(FINGERPRINT, JSON.stringify(fp, null, 1));
const st = fs.statSync(ZIP);
console.log(
  `# packaged ${path.basename(ZIP)} (${st.size} bytes, ${fp.length} files)\n# zip sha256=${sha256(ZIP)}\n# manifest untouched: version stays 0.1.11, watermark preserved  [NOT PUBLISHED]`
);

if (DEPLOY) {
  const backup = path.join(BACKUP_DIR, 'deployed-before-merge');
  fs.rmSync(backup, { recursive: true, force: true });
  copyTree(DEPLOYED, backup);
  console.log(`# backed up deployed package -> ${path.relative(ROOT, backup)}`);
  fs.rmSync(DEPLOYED, { recursive: true, force: true });
  copyTree(STAGE, DEPLOYED);
  console.log(`# deployed merged package -> ${DEPLOYED}`);
} else {
  console.log('# staged package NOT deployed. After the probe verdict passes, re-run with --deploy.');
}
