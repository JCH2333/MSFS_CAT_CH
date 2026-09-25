/**
 * Roll the tooltip layer back out of the local Community folders.
 *
 * Restores each patch package from the pre-change backup taken by deploy-tooltip.mjs, then
 * proves the restore by hashing EVERY file against the backup — a version number in the
 * manifest is not evidence that the tree is the tree that was there before.
 *
 *   node tools/tooltip-zh/revert-tooltip.mjs [--keep-zips]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateLayout } from './pack.mjs';

const ROOT = 'F:/我的世界动画/ai项目/gsx汉化';
const COMMUNITIES = ['F:/games/community/Community', 'F:/games/community/Community2024'];

const expect = {
  'zzz-JCH-fenix-a320-efb-zh-patch': { version: '0.1.1', entries: 5 },
  'zzz-JCH-a340-efb-zh-patch': { version: '0.1.2', entries: 7 },
  'zzz-JCH-a350-efb-zh-patch': { version: '0.2.0', entries: 38 },
  'zzz-JCH-a380-efb-zh-patch': { version: '0.1.11', entries: 9 },
};

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tree = (d, rel = '', out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) tree(path.join(d, e.name), r, out);
    else out.push(r);
  }
  return out;
};
const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else {
      fs.copyFileSync(s, d);
      n++;
    }
  }
  return n;
};

// find, for each package, the newest backup that is genuinely pre-tooltip
const backups = {};
for (const stamp of fs.readdirSync(path.join(ROOT, '.local-backups')).filter((n) => n.startsWith('tooltip-')).sort()) {
  for (const pkg of Object.keys(expect)) {
    const p = path.join(ROOT, '.local-backups', stamp, pkg);
    if (!fs.existsSync(p)) continue;
    if (fs.existsSync(path.join(p, 'zh-CN.locPak'))) continue; // already-layered, not a clean original
    const man = JSON.parse(fs.readFileSync(path.join(p, 'manifest.json'), 'utf8'));
    if (man.package_version !== expect[pkg].version) continue;
    backups[pkg] = p; // later stamps overwrite, but only clean-version ones qualify
  }
}

console.log('# rollback');
for (const [pkg, want] of Object.entries(expect)) {
  const bak = backups[pkg];
  if (!bak) {
    console.log(`!! ${pkg}: no clean pre-tooltip backup found — NOT touched, restore by hand`);
    continue;
  }
  const bakFiles = tree(bak);
  const targets = COMMUNITIES.map((c) => path.join(c, pkg)).filter((p) => fs.existsSync(p));
  console.log(`\n## ${pkg}  (source ${path.relative(ROOT, bak)}, ${bakFiles.length} files)`);
  for (const dest of targets) {
    // record what is being undone, so the rollback is auditable after the fact
    const willUndo = bakFiles.filter((f) => {
      const cur = path.join(dest, f);
      if (!fs.existsSync(cur)) return false;
      try {
        return sha256(cur) !== sha256(path.join(bak, f));
      } catch {
        return true;
      }
    });
    const willRemove = tree(dest).filter((f) => !bakFiles.includes(f));
    console.log(`   undoing: ${willRemove.length ? 'remove [' + willRemove.join(', ') + '] ' : ''}${willUndo.length ? 'restore ' + willUndo.length + ' changed file(s)' : ''}`);
    const removed = fs.existsSync(path.join(dest, 'zh-CN.locPak'));
    fs.rmSync(dest, { recursive: true, force: true });
    const n = copyTree(bak, dest);
    // prove it: same file set, same hashes, no locPak, layout consistent, version back
    const nowFiles = tree(dest).sort();
    const wantFiles = bakFiles.slice().sort();
    const missing = wantFiles.filter((f) => !nowFiles.includes(f));
    const extra = nowFiles.filter((f) => !wantFiles.includes(f));
    const diff = wantFiles.filter((f) => {
      try {
        return sha256(path.join(bak, f)) !== sha256(path.join(dest, f));
      } catch {
        return true;
      }
    });
    const man = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
    const v = validateLayout(dest);
    const entries = JSON.parse(fs.readFileSync(path.join(dest, 'layout.json'), 'utf8')).content.length;
    const hasLocPak = fs.existsSync(path.join(dest, 'zh-CN.locPak'));
    // Two DIFFERENT questions, previously conflated and reported as one failure:
    //   fidelity  = does the restored tree equal the backed-up tree, byte for byte
    //   hygiene   = does that tree's layout.json describe itself correctly (a PRE-EXISTING
    //               property of the vendor patch, e.g. ini A380 declares stale sizes; a
    //               faithful rollback must restore that defect, not hide it)
    const faithful = !missing.length && !extra.length && !diff.length && !hasLocPak && man.package_version === want.version && entries === want.entries;
    console.log(`   ${dest.includes('Community2024') ? 'Community2024' : 'Community    '} -> v${man.package_version} entries=${entries} files=${n} ` +
      `hash-diff=${diff.length} extra=${extra.length} locPak=${hasLocPak}`);
    console.log(`   ${faithful ? '   RESTORED — tree is byte-identical to the pre-change backup' : '   !!! NOT FAITHFUL — investigate'}`);
    if (!v.ok) console.log(`   note: package layout still self-reports ${v.errors.length} issue(s) that predate the tooltip work (unchanged by this rollback)`);
  }
}

// The rolled-back builds stay on disk for forensics but out of the patch folder so nothing
// can accidentally install them. EXACT names only: a version-number regex swept up three
// pre-existing builds the first time this ran (inia340 v0.1.2, inia380 v0.1.2/v0.1.3),
// because the tooltip build reused version numbers that other aircraft had already used.
const TOOLTIP_BUILDS = [
  'msfs-cat-ch-fenix-a320-efb-zh-cn-v0.1.2',
  'msfs-cat-ch-inia340-efb-zh-cn-v0.1.3',
  'msfs-cat-ch-ini350-efb-zh-cn-v0.2.1',
  'msfs-cat-ch-inia380-efb-zh-cn-v0.1.12',
];
if (!process.argv.includes('--keep-zips')) {
  const hold = path.join(ROOT, '.local-backups/rolled-back-tooltip-builds');
  fs.mkdirSync(hold, { recursive: true });
  for (const base of TOOLTIP_BUILDS) {
    for (const suffix of ['.zip', '.fingerprint.json']) {
      const f = base + suffix;
      const src = path.join(ROOT, 'local-patches', f);
      if (!fs.existsSync(src)) continue;
      fs.renameSync(src, path.join(hold, f));
      console.log(`moved aside  ${f}`);
    }
  }
}
console.log('\n# restart the sim fully after this: 2024 caches the package list at boot.');
