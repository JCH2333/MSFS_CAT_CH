/**
 * Deploy the tooltip layer as a NEW LOCAL patch version, additively.
 *
 * Rules this obeys from the project's own conventions:
 *   - the previous version's files are never edited in place: the package is copied, the
 *     copy is stamped with a new version, and the original is backed up first
 *   - nothing already in the package is removed or reworded; the only new payload is
 *     zh-CN.locPak plus its layout.json entry
 *   - every produced version stays UNPUBLISHED: it lands in local-patches/ with a
 *     fingerprint, and no server call is made
 *
 *   node tools/tooltip-zh/deploy-tooltip.mjs [--only fenix,a340] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateLayout } from './pack.mjs';

const ROOT = 'F:/我的世界动画/ai项目/gsx汉化';
const COMMUNITIES = ['F:/games/community/Community', 'F:/games/community/Community2024'];
const STAMP = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');

const TARGETS = {
  fenix: {
    id: 'msfs-cat-ch-fenix-a320-efb-zh-cn',
    pkg: 'zzz-JCH-fenix-a320-efb-zh-patch',
    dict: '.local-lab/tooltip/dict-fenix.json',
    base: null,
    nextVersion: '0.1.2',
  },
  a340: {
    id: 'msfs-cat-ch-inia340-efb-zh-cn',
    pkg: 'zzz-JCH-a340-efb-zh-patch',
    dict: '.local-lab/tooltip/dict-ini-a340.json',
    base: 'F:/games/community/Community/inibuilds-aircraft-a340',
    nextVersion: '0.1.3',
  },
  a350: {
    id: 'msfs-cat-ch-ini350-efb-zh-cn',
    pkg: 'zzz-JCH-a350-efb-zh-patch',
    dict: '.local-lab/tooltip/dict-ini-a350.json',
    base: 'F:/games/community/Community2024/inibuilds-aircraft-a350',
    nextVersion: '0.2.1',
  },
  a380: {
    id: 'msfs-cat-ch-inia380-efb-zh-cn',
    pkg: 'zzz-JCH-a380-efb-zh-patch',
    dict: '.local-lab/tooltip/dict-ini-a380.json',
    base: 'F:/games/community/Official2024/Steam/inibuilds-aircraft-a380',
    nextVersion: '0.1.12',
    // this package's layout.json still declares the ORIGINAL vendor file sizes; correct
    // them to the bytes actually shipped before adding anything of our own
    fixSizes: true,
  },
};

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : Object.keys(TARGETS);
/**
 * Node's fs.cpSync silently copies nothing on this machine (reproduced with an empty
 * destination and no error), so the tree copy is done explicitly. A silent no-op is the
 * worst possible failure mode for a deploy step.
 */
const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
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
const countTree = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? countTree(path.join(d, e.name)) : 1), 0);
const emit = (dir, dict, base, extra = []) => {
  const args = [path.join(ROOT, 'tools/tooltip-zh/emit-patch.mjs'), dir, '--dict', dict];
  if (base) args.push('--base', base);
  args.push(...extra);
  return execFileSync('node', args, { encoding: 'utf8' });
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const bumpManifest = (dir, version, note) => {
  const p = path.join(dir, 'manifest.json');
  let t = fs.readFileSync(p, 'utf8');
  const before = t;
  t = t.replace(/("package_version"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(version)}`);
  t = t.replace(/("LastUpdate"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(note)}`);
  if (t === before) throw new Error(`manifest.json in ${dir} has no package_version/LastUpdate to rewrite`);
  fs.writeFileSync(p, t);
  return JSON.parse(t).package_version;
};

for (const name of ONLY) {
  const t = TARGETS[name];
  if (!t) {
    console.log(`!! unknown target ${name}`);
    continue;
  }
  const installed = COMMUNITIES.map((c) => path.join(c, t.pkg)).find((p) => fs.existsSync(p));
  if (!installed) {
    console.log(`## ${name}: ${t.pkg} is not installed in either community — skipped`);
    continue;
  }
  console.log(`\n## ${name}  (base ${installed})`);
  const stage = path.join(ROOT, `.local-lab/tooltip-stage/${t.pkg}`);
  fs.rmSync(path.dirname(stage), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stage), { recursive: true });
  if (DRY) {
    console.log(`   [dry] would copy -> ${stage}, stamp ${t.nextVersion}, add zh-CN.locPak, back up and redeploy`);
    continue;
  }
  const copied = copyTree(installed, stage);
  const srcCount = countTree(installed);
  if (copied !== srcCount) throw new Error(`copy incomplete: staged ${copied} of ${srcCount} files`);
  console.log(`   staged ${copied} files`);
  console.log('  ' + emit(stage, path.join(ROOT, t.dict), t.base, t.fixSizes ? ['--fix-sizes'] : []).trim().split('\n').join('\n  '));
  const v = bumpManifest(stage, t.nextVersion, `tooltip layer added ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  const check = validateLayout(stage);
  if (!check.ok) throw new Error(`staged package invalid: ${check.errors.join('; ')}`);
  console.log(`   staged version -> ${v}, layout valid (${check.entries} entries)`);

  const backup = path.join(ROOT, `.local-backups/tooltip-${STAMP}/${t.pkg}`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  copyTree(installed, backup);
  console.log(`   backed up original -> ${path.relative(ROOT, backup)}`);

  for (const c of COMMUNITIES) {
    const dest = path.join(c, t.pkg);
    if (!fs.existsSync(dest)) continue;
    fs.rmSync(dest, { recursive: true, force: true });
    copyTree(stage, dest);
    console.log(`   deployed -> ${dest}`);
  }

  const zip = path.join(ROOT, 'local-patches', `${t.id}-v${t.nextVersion}.zip`);
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  fs.rmSync(zip, { force: true });
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.dirname(stage)}\\${t.pkg}' -DestinationPath '${zip}' -Force`]);
  const files = [];
  const walk = (d, rel, base = rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r, base);
      else files.push({ rel: `${base}/${r}`, abs: path.join(d, e.name) });
    }
  };
  walk(stage, '', t.pkg);
  const fp = files.map((f) => ({ relativePath: f.rel, sha256: sha256(f.abs) }));
  fs.writeFileSync(zip.replace(/\.zip$/, '.fingerprint.json'), JSON.stringify(fp, null, 1));
  const st = fs.statSync(zip);
  console.log(`   packaged ${path.basename(zip)} (${st.size} bytes, ${fp.length} files) sha256=${sha256(zip).slice(0, 16)}…  [NOT PUBLISHED]`);
}
