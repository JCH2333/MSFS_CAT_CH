/**
 * Workload measurement for the iniBuilds family (and any locPak-based aircraft).
 *
 * A380 wrinkle found during discovery: the ingested Marketplace package ships 17 language
 * files but NO loose en-US — the English lives inside minimal.fsarchive. Because every
 * vendor zh-CN tooltip value is byte-identical to the English there, zh-CN doubles as the
 * English source. This script handles that so the numbers are honest.
 */
import fs from 'node:fs';
import { readLocPak, listLocPakFiles, isTooltipKey, hasCjk } from './lib.mjs';
import { loadTermbase } from './dict-engine.mjs';

const tb = loadTermbase();
const DIRS = {
  a340: 'F:/games/community/Community/inibuilds-aircraft-a340',
  a350: 'F:/games/community/Community2024/inibuilds-aircraft-a350',
  a380: 'F:/games/community/Official2024/Steam/inibuilds-aircraft-a380',
  fenix: 'F:/games/community/Community/fnx-aircraft-320',
};

// Descriptive prose that is not a panel label; it belongs to loading screens, not tooltips.
const NOT_A_TOOLTIP = /^(The |A |This |Our |Please|Note:|Warning:|INFO|You )/;

const report = {};
for (const [name, dir] of Object.entries(DIRS)) {
  const ps = listLocPakFiles(dir);
  const enP = ps.find((p) => /^en-us$/i.test(p.language));
  const zhP = ps.find((p) => /^zh-cn$/i.test(p.language));
  const srcP = enP ?? zhP;
  if (!srcP) { console.log(`${name}: no locPak`); continue; }
  const en = readLocPak(srcP.file).strings;
  const zh = zhP ? readLocPak(zhP.file).strings : {};
  const tk = Object.keys(en).filter(isTooltipKey);
  const needRaw = tk.filter((k) => !zh[k] || zh[k] === en[k] || !String(zh[k]).trim());
  const distinct = [...new Set(needRaw.map((k) => String(en[k]).replace(/\s+/g, ' ').trim()))].filter(Boolean);
  const prose = distinct.filter((v) => NOT_A_TOOLTIP.test(v) && v.split(' ').length > 6);
  const labels = distinct.filter((v) => !prose.includes(v));
  const covered = labels.filter((v) => tb.has(v));
  const rest = labels.filter((v) => !tb.has(v));
  report[name] = { tooltipKeys: tk.length, needKeys: needRaw.length, distinct: distinct.length, prose: prose.length, labels: labels.length, termbaseHits: covered.length, manual: rest.length };
  console.log(`## ${name}  (${srcP.language} as source)`);
  console.log(`   tooltip keys=${tk.length}  need zh=${needRaw.length}  distinct=${distinct.length}`);
  console.log(`   prose/loading text=${prose.length}  panel labels=${labels.length}  termbase hit=${covered.length}  TO AUTHOR=${rest.length}`);
  const buckets = new Map();
  for (const v of rest) {
    const head = v.split(' ').slice(0, 2).join(' ');
    buckets.set(head, (buckets.get(head) ?? 0) + 1);
  }
  console.log('   top stems still to author:');
  for (const [h, c] of [...buckets].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`      ${h.padEnd(26)} x${c}`);
  console.log('');
}
fs.writeFileSync('.local-lab/tooltip/workload.json', JSON.stringify(report, null, 1));
