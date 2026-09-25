/**
 * Round-4 probe: the VENDOR-CHANNEL leg (2026-09-25 evening).
 *
 * Evidence so far: FBW A380X (communityfs20, own package) renders its own zh-CN.locPak in-game,
 * while EVERY separate probe package (2 zones × 2 content_types × casing × zh/en, rounds 1-3)
 * stayed silent. Working hypothesis: MSFS2024's localization only reads locPak files that live
 * INSIDE the aircraft's own package; separately packaged locPaks never reach the string table.
 *
 * This probe appends a zh-CN.locPak to the Fenix vendor package itself
 * (fnx-aircraft-320, a plain editable Community package) with two marker keys on the
 * battery 1 switch. Full restart, hover battery 1:
 *   【探针V】接通/断开电池1  => vendor channel proven; A380 production = fill the vendor's
 *                               own zh-cn.locpak (needs user consent + backups, marketplace pkg)
 *   still English          => even the own-package channel fails for community-added files;
 *                               remaining option: edit the vendor's EXISTING en-US/zh values in place
 *
 * Revert: node tools/tooltip-zh/build-vendor-probe.mjs --clean
 * (restores the backup layout.json and removes zh-CN.locPak)
 */
import fs from 'node:fs';
import path from 'node:path';
import { layoutUpsert, layoutEntries, filetime18, buildLocPakJson } from './pack.mjs';

const VENDOR = 'F:/games/community/Community/fnx-aircraft-320';
const BACKUP = 'F:/我的世界动画/AI项目/GSX汉化/.local-backups/vendor-probe-fenix';
const TARGET = path.join(VENDOR, 'zh-CN.locPak');
const LAYOUT = path.join(VENDOR, 'layout.json');

const KEYS = {
  'FNX320.TOOLTIPS.Electrical_Battery_1_Button.ON': '【探针V】接通电池1',
  'FNX320.TOOLTIPS.Electrical_Battery_1_Button.OFF': '【探针V】断开电池1',
};

if (process.argv.includes('--clean')) {
  const backupLayout = path.join(BACKUP, 'layout.json');
  if (!fs.existsSync(backupLayout)) throw new Error('no backup layout.json to restore');
  fs.copyFileSync(backupLayout, LAYOUT);
  if (fs.existsSync(TARGET)) fs.rmSync(TARGET);
  const ok = !fs.existsSync(TARGET) && !fs.readFileSync(LAYOUT, 'utf8').includes('zh-CN.locPak');
  console.log(`# vendor probe reverted: locPak removed, layout restored (clean=${ok})`);
  process.exit(0);
}

fs.mkdirSync(BACKUP, { recursive: true });
if (fs.existsSync(TARGET)) throw new Error('zh-CN.locPak already present in the vendor package');
fs.copyFileSync(LAYOUT, path.join(BACKUP, 'layout.json'));
console.log('# layout.json backed up');

fs.writeFileSync(TARGET, buildLocPakJson('zh-CN', KEYS));
const size = fs.statSync(TARGET).size;
const date = filetime18(fs.statSync(TARGET).mtimeMs);

const text = fs.readFileSync(LAYOUT, 'utf8');
const next = layoutUpsert(text, [{ path: 'zh-CN.locPak', size, date }], '    ');
fs.writeFileSync(LAYOUT, next);

// targeted validation: entry count agreement, our entry correct, file exists
const listed = layoutEntries(next);
const parsed = JSON.parse(next).content;
const entry = listed.find((e) => e.path === 'zh-CN.locPak');
const problems = [];
if (listed.length !== parsed.length) problems.push(`entry count drift: text ${listed.length} vs json ${parsed.length}`);
if (!entry) problems.push('zh-CN.locPak not registered');
else {
  if (entry.size !== size) problems.push(`size drift ${entry.size} != ${size}`);
  if (!/^\d{18}$/.test(entry.date)) problems.push('date not 18-digit FILETIME');
}
if (problems.length) {
  fs.writeFileSync(LAYOUT, text);
  fs.rmSync(TARGET, { force: true });
  throw new Error('validation failed, vendor package restored:\n  ' + problems.join('\n  '));
}
console.log(`# zh-CN.locPak written (${size} bytes, ${Object.keys(KEYS).length} keys) and registered`);
console.log(`# layout entries ${layoutEntries(text).length} -> ${listed.length}`);
console.log('# revert: node tools/tooltip-zh/build-vendor-probe.mjs --clean');
