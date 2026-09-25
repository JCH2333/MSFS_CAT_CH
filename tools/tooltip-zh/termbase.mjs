/**
 * Shared English->Chinese term base, mined only from localisations that already ship and
 * are already reviewed by the community:
 *
 *   fs-base   the game's own official Chinese (authoritative for generic cockpit wording)
 *   ini A340  iniBuilds' own zh-CN, minus the keys they left as English copy
 *   FBW       FlyByWire's zh-CN
 *
 * Nothing here is invented: every pair is a real (en, zh) line from a shipping package.
 * The tooltip dictionaries are built by looking English text up here FIRST, so the new
 * feature reads like the rest of the Chinese UI instead of like a machine.
 *
 *   node tools/tooltip-zh/termbase.mjs [--json out] [--top N] [--grep pattern]
 */
import fs from 'node:fs';
import path from 'node:path';
import { readLocPak, listLocPakFiles, hasCjk, isTooltipKey } from './lib.mjs';

const argv = process.argv.slice(2);
const OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : '.local-lab/tooltip/termbase.json';
const TOP = argv.includes('--top') ? +argv[argv.indexOf('--top') + 1] : 40;
const GREP = argv.includes('--grep') ? argv[argv.indexOf('--grep') + 1] : null;

const SOURCES = [
  { tag: 'fs-base', dir: 'F:/SteamLibrary/steamapps/common/MSFS2024/Packages/fs-base', onlyTooltip: false },
  { tag: 'ini-a340', dir: 'F:/games/community/Community/inibuilds-aircraft-a340', onlyTooltip: true },
  { tag: 'fbw-a320n', dir: 'F:/games/community/Community/flybywire-aircraft-a320-neo', onlyTooltip: true },
];

function pairFor(src) {
  const paks = listLocPakFiles(src.dir);
  const en = paks.find((p) => /^en-us$/i.test(p.language));
  const zh = paks.find((p) => /^zh-cn$/i.test(p.language));
  if (!en || !zh) return [];
  const e = readLocPak(en.file).strings;
  const z = readLocPak(zh.file).strings;
  const out = [];
  for (const [k, ev] of Object.entries(e)) {
    if (src.onlyTooltip && !isTooltipKey(k)) continue;
    const zv = z[k];
    if (typeof zv !== 'string' || !zv.trim()) continue;
    if (zv === ev) continue; // untranslated stub
    if (!hasCjk(zv)) continue; // transliteration / other language
    if (typeof ev !== 'string' || !ev.trim()) continue;
    if (/[\u3400-\u9fff]/.test(ev)) continue;
    out.push({ key: k, en: ev.trim(), zh: zv.trim(), src: src.tag });
  }
  return out;
}

const pairs = [];
for (const s of SOURCES) {
  const p = pairFor(s);
  console.log(`# ${s.tag.padEnd(12)} usable pairs: ${p.length}`);
  pairs.push(...p);
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const exact = new Map();
const loose = new Map();
for (const p of pairs) {
  const e = norm(p.en);
  if (!exact.has(e)) exact.set(e, { zh: norm(p.zh), srcs: new Set(), keys: [] });
  const rec = exact.get(e);
  rec.srcs.add(p.src);
  if (rec.keys.length < 4) rec.keys.push(p.key);
  const l = e.toLowerCase();
  if (!loose.has(l)) loose.set(l, { zh: rec.zh, srcs: rec.srcs, keys: rec.keys });
  else loose.get(l).srcs.add(p.src);
}

// Term frequency over English sides, to expose the recurring cockpit vocabulary
const tokenCount = new Map();
for (const [en, rec] of exact) {
  for (const tok of en.split(/[^A-Za-z0-9/()-]+/).filter((t) => t.length > 1)) {
    const k = tok.toUpperCase();
    if (!tokenCount.has(k)) tokenCount.set(k, { n: 0, zh: new Map() });
    const t = tokenCount.get(k);
    t.n++;
    for (const ch of norm(rec.zh).match(/[一-龥]{2,6}/g) ?? []) t.zh.set(ch, (t.zh.get(ch) ?? 0) + 1);
  }
}

if (GREP) {
  const re = new RegExp(GREP, 'i');
  console.log(`\n# grep "${GREP}" in exact pairs`);
  let n = 0;
  for (const [en, rec] of [...exact].sort((a, b) => b[1].srcs.size - a[1].srcs.size)) {
    if (!re.test(en) && !re.test(rec.zh)) continue;
    if (n++ > TOP) break;
    console.log(`   ${en.padEnd(46).slice(0, 46)} -> ${rec.zh}   [${[...rec.srcs]}]`);
  }
  console.log(`   (${n} shown)`);
  process.exit(0);
}

console.log(`\n# exact pairs: ${exact.size} | case-folded: ${loose.size}`);
console.log(`# most reused English sentences (>=2 source packages first):`);
for (const [en, rec] of [...exact].sort((a, b) => b[1].srcs.size - a[1].srcs.size || b[1].keys.length - a[1].keys.length).slice(0, TOP))
  console.log(`   ${en.padEnd(48).slice(0, 48)} -> ${rec.zh}  [${[...rec.srcs].join('+')}]`);

console.log(`\n# recurring cockpit tokens and the Chinese they map to:`);
for (const [tok, t] of [...tokenCount].sort((a, b) => b[1].n - a[1].n).slice(0, TOP)) {
  const tops = [...t.zh].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c}(${n})`).join(' ');
  console.log(`   ${tok.padEnd(16)} x${String(t.n).padEnd(5)} ${tops}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), exact: [...exact].map(([en, r]) => ({ en, zh: r.zh, srcs: [...r.srcs], keys: r.keys })) }, null, 1));
console.log(`\n# wrote ${OUT}`);
