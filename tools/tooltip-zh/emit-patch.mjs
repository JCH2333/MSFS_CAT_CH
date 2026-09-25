/**
 * Additive emitter: drops a tooltip zh-CN.locPak into an ALREADY BUILT patch package and
 * registers it in that package's layout.json.
 *
 * This is deliberately a *post-processing* step. The existing shadow builds (html_ui
 * overrides, fonts, engines) are not modified at all — the tooltip feature is layered on
 * top of whatever the build already produced, so an aircraft that already ships a
 * localised EFB gains hover tooltips without any of that work being re-touched.
 *
 *   node tools/tooltip-zh/emit-patch.mjs <patchPkgDir> --dict <dict.json>
 *                                        [--keys <extra-keys.json>] [--check]
 *
 * Hard gates, all of them learned the expensive way elsewhere in this project:
 *   - layout.json is spliced as TEXT; its 18-digit FILETIME values must not round-trip
 *     through JSON.parse (precision loss corrupts the package in ways that look like
 *     unrelated scene damage).
 *   - every file on disk must be listed with the correct size, and the entry count must
 *     agree between the text reader and JSON.parse, or we refuse to write.
 *   - an empty or whitespace-only translation is rejected: it would blank a line that
 *     English would otherwise have filled.
 */
import fs from 'node:fs';
import path from 'node:path';
import { layoutUpsert, layoutEntries, validateLayout, filetime18, buildLocPakJson, layoutFixSizes } from './pack.mjs';
import { readLocPak, listLocPakFiles, isTooltipKey } from './lib.mjs';

const argv = process.argv.slice(2);
const PKG = argv.find((a) => !a.startsWith('--'));
const DICT = argv.includes('--dict') ? argv[argv.indexOf('--dict') + 1] : null;
const CHECK = argv.includes('--check');
const FIX_SIZES = argv.includes('--fix-sizes');
if (!PKG || (!DICT && !CHECK)) {
  console.error('usage: emit-patch.mjs <patchPkgDir> --dict <dict.json> [--check]');
  process.exit(2);
}
const pkgDir = path.resolve(PKG);
if (!fs.existsSync(path.join(pkgDir, 'layout.json'))) {
  console.error(`not a patch package (no layout.json): ${pkgDir}`);
  process.exit(1);
}

const before = validateLayout(pkgDir);
console.log(`# package ${path.basename(pkgDir)}  entries=${before.entries} files=${before.files} pre-ok=${before.ok}`);
if (!before.ok) {
  const onlySizes = before.errors.every((e) => /size mismatch/.test(e));
  if (!FIX_SIZES || !onlySizes) {
    console.error('REFUSED: the package layout is already inconsistent:\n  ' + before.errors.join('\n  '));
    if (!onlySizes) console.error('  (not repairable: mix of size and structural errors)');
    else console.error('  (pass --fix-sizes to declare sizes from the bytes on disk)');
    process.exit(1);
  }
  const layoutPath0 = path.join(pkgDir, 'layout.json');
  const orig = fs.readFileSync(layoutPath0, 'utf8');
  const { text: repaired, changes } = layoutFixSizes(orig, pkgDir);
  fs.writeFileSync(layoutPath0, repaired);
  const recheck = validateLayout(pkgDir);
  if (!recheck.ok) {
    console.error('REFUSED: --fix-sizes did not resolve it:\n  ' + recheck.errors.join('\n  '));
    fs.writeFileSync(layoutPath0, orig);
    process.exit(1);
  }
  console.log(`# --fix-sizes: corrected ${changes.length} declared sizes to match disk`);
  for (const c of changes) console.log(`     ${c.path}: ${c.declared} -> ${c.actual}`);
}
if (CHECK) {
  console.log('# --check only');
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(DICT, 'utf8'));
const dict = raw.dict ?? raw;
const problems = [];
const payload = {};
for (const [key, value] of Object.entries(dict)) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!isTooltipKey(key) && !/^(INI|FNX320|A32NX|COCKPIT|AIRCRAFT)\./.test(key)) problems.push(`odd key namespace: ${key}`);
  if (!v) {
    problems.push(`empty value (would blank the line): ${key}`);
    continue;
  }
  payload[key] = v;
}
if (problems.length) {
  console.error(`REFUSED: ${problems.length} dictionary problems:`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  process.exit(1);
}

// Seed from the vendor's own zh-CN when asked. Key-level merging across packages is what
// the installed evidence shows (fs-base, FBW and iniBuilds each contribute), but a
// superset costs nothing and is safe under EITHER semantic: if a future loader resolved
// locPaks per-file, a gaps-only file would silently delete the vendor's translations.
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;
const seed = {};
if (BASE) {
  const vendorZh = listLocPakFiles(BASE).find((p) => /^zh-cn$/i.test(p.language));
  if (!vendorZh) {
    console.error(`--base given but ${BASE} has no zh-CN locPak`);
    process.exit(1);
  }
  Object.assign(seed, readLocPak(vendorZh.file).strings);
  console.log(`# seeded ${Object.keys(seed).length} keys from vendor ${path.basename(BASE)}`);
}

// Never drop a translation the package already carries: our authored keys win, everything
// else is carried through.
const existingPak = listLocPakFiles(pkgDir).find((p) => /^zh-cn$/i.test(p.language));
const merged = { ...seed, ...(existingPak ? readLocPak(existingPak.file).strings : {}), ...payload };
console.log(`# final zh-CN.locPak: ${Object.keys(merged).length} keys (${Object.keys(payload).length} authored tooltip entries on top)`);

const json = buildLocPakJson('zh-CN', merged);
const target = path.join(pkgDir, 'zh-CN.locPak');
fs.writeFileSync(target, json);
const size = fs.statSync(target).size;
const date = filetime18(fs.statSync(target).mtimeMs);

const layoutPath = path.join(pkgDir, 'layout.json');
const text = fs.readFileSync(layoutPath, 'utf8');
const indentMatch = /^(\s*)\{/.exec(text.slice(text.indexOf('"content"')));
const next = layoutUpsert(text, [{ path: 'zh-CN.locPak', size, date }], indentMatch ? '\n' + indentMatch[1].replace(/^\n/, '') + '    ' : '        ');
fs.writeFileSync(layoutPath, next);

const after = validateLayout(pkgDir);
if (!after.ok) {
  console.error('REFUSED RESULT — layout validation failed after write, restoring:');
  console.error('  ' + after.errors.join('\n  '));
  fs.writeFileSync(layoutPath, text);
  fs.rmSync(target, { force: true });
  process.exit(1);
}
const reRead = layoutEntries(fs.readFileSync(layoutPath, 'utf8')).find((e) => e.path === 'zh-CN.locPak');
console.log(`# wrote zh-CN.locPak (${size} bytes) and registered it: size=${reRead?.size} date=${reRead?.date}`);
console.log(`# layout entries ${before.entries} -> ${after.entries}, files=${after.files}, valid=${after.ok}`);
