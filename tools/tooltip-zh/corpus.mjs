/**
 * Tooltip corpus builder — the authoritative "what must be translated" list.
 *
 * A tooltip key is resolved by the sim against the UNION of every loaded localisation
 * package (vendor package .locPak + base-game fs-base .locPak), so the real gap is not
 * "what the vendor forgot" but "what nobody defines". This tool computes exactly that:
 *
 *   referenced   keys the aircraft's cockpit behaviour actually asks for
 *   inEn         present in vendor en-US  OR  fs-base en-US      (else: dead key)
 *   zhStatus     translated / identical-to-English / empty / absent, from
 *                vendor zh-CN preferred, falling back to fs-base zh-CN
 *
 * Vocabulary was collected empirically from the installed packages (see NOTES.md);
 * MSFS 2024 aircraft use the Interactions-Manager fields (TTTitle / TTDescription /
 * TTValue / TTInteraction*), while 2020-era packages use <TooltipID>, which may hold
 * either a `TT:` key or a hardcoded English sentence.
 *
 *   node tools/tooltip-zh/corpus.mjs <packageDir> [--json out.json] [--show N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles, listLocPakFiles, readLocPak, hasCjk, isTooltipKey } from './lib.mjs';
import { parseTemplates, findUses, resolveTooltipValues, expand as expandWith } from './mb.mjs';

const argv = process.argv.slice(2);
const PKG = argv.find((a) => !a.startsWith('--'));
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const SHOW = argv.includes('--show') ? +argv[argv.indexOf('--show') + 1] : 12;
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'F:/SteamLibrary/steamapps/common/MSFS2024/Packages/fs-base';
if (!PKG) {
  console.error('usage: corpus.mjs <packageDir> [--json out.json] [--show N]');
  process.exit(2);
}

/** Tags whose text is shown in, or keys a row of, the hover bubble. */
const DISPLAY_TAGS = [
  'TooltipID',
  'AnimTip',
  'AnimTip_0',
  'AnimTip_1',
  'AnimTip_2',
  'AnimTip_3',
  'TTTitle',
  'TTDescription',
  'TTValue',
  'TTInteraction',
  'TTInteractionLockable',
  'TT_DESCRIPTION',
  'TT_VALUE',
  'TT_TITLE',
  'TT_VALUE_0',
  'TT_VALUE_1',
  'TT_VALUE_2',
  'TT_VALUE_3',
  'TT_DESCRIPTION_COVER',
  'TT_VALUE_COVER',
  'TOOLTIP_TITLE',
  'TOOLTIP_DESCRIPTION',
  'TOOLTIP_VALUE',
  'TOOLTIP_TITLE_COVER',
  'TOOLTIP_ID',
  'IE_TOOLTIP_TITLE_ID',
  'IE_TOOLTIP_DESCRIPTION_ID',
  'IE_TOOLTIP_VALUE_ID',
];
const DISPLAY_SET = new Set(DISPLAY_TAGS.map((t) => t.toLowerCase()));

/** `TT:NS.KEY`, `@TT_Package.X.Y`, and keys embedded in `(R:1:NS.KEY)` string-resolve macros.
 *  Keys are MIXED case (FNX320.TOOLTIPS.Electrical_Battery_1_Button.PRESS), so no [A-Z] classes. */
const KEY_PATTERNS = [
  /(?:^|[^\w.])TT:([A-Za-z0-9_.#-]+)/g,
  /@TT_Package\.([A-Za-z0-9_.#-]+)/g,
  /\(\s*R\s*:\s*\d*\s*:?\s*([A-Za-z0-9_.#-]{5,})\s*\)/g,
];
const BARE_KEY = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_#-]+){2,}$/;

function extractKeys(value) {
  const out = [];
  KEY_PATTERNS.forEach((re, i) => {
    for (const m of value.matchAll(re)) out.push(i === 1 ? `@TT_Package.${m[1]}` : m[1]);
  });
  const v = value.trim();
  if (!out.length && BARE_KEY.test(v)) out.push(v);
  return [...new Set(out.map((k) => k.replace(/[.\s]+$/, '')))].filter((k) => k.includes('.'));
}

// ---------------------------------------------------------------- 1. referenced values
const xml = walkFiles(PKG, (n) => /\.xml$/i.test(n));
const sources = new Map();
for (const f of xml) {
  try {
    const t = fs.readFileSync(f, 'utf8');
    if (/<Template\s+Name=/i.test(t) || /<UseTemplate/i.test(t) || DISPLAY_TAGS.some((g) => new RegExp(`<${g}>`, 'i').test(t)))
      sources.set(f, t);
  } catch {}
}
const templates = parseTemplates(sources);
const found = [];
for (const [f, text] of sources) {
  const outside = text.replace(/<Template\s+Name="[^"]+"[\s\S]*?<\/Template>/gi, '');
  for (const use of findUses(outside)) {
    if (!templates.has(use.name)) continue;
    for (const r of resolveTooltipValues(templates, use.name, use.block)) {
      if (!DISPLAY_SET.has(String(r.tag).toLowerCase())) continue;
      found.push({ file: path.relative(PKG, f), tag: r.tag, value: r.value });
    }
  }
  for (const tag of DISPLAY_TAGS) {
    const re = new RegExp(`<${tag}(?:\\s[^>/]*)?>([^<]*)</${tag}\\s*>`, 'gi');
    for (const m of outside.matchAll(re)) found.push({ file: path.relative(PKG, f), tag, value: m[1].replace(/\s+/g, ' ').trim() });
  }
}

// ---------------------------------------------------------------- 2. split keys vs literals
const keyRefs = new Map();
const literals = new Map();
for (const r of found) {
  if (!r.value) continue;
  const keys = extractKeys(r.value);
  if (keys.length) {
    for (const k of keys) {
      if (!keyRefs.has(k)) keyRefs.set(k, { count: 0, files: new Set(), tags: new Set() });
      const e = keyRefs.get(k);
      e.count++;
      e.files.add(r.file);
      e.tags.add(r.tag);
    }
  } else if (r.value && !/#\w+#/.test(r.value) && !/^[A-Z][A-Z0-9_]*$/.test(r.value.trim())) {
    const cleaned = r.value.replace(/\(\s*%\(.*/g, '').trim();
    if (!cleaned) continue;
    if (!literals.has(r.value)) literals.set(r.value, { count: 0, files: new Set(), tags: new Set() });
    const e = literals.get(r.value);
    e.count++;
    e.files.add(r.file);
    e.tags.add(r.tag);
  }
}

// ---------------------------------------------------------------- 3. resolution tables
function loadStrings(dir, lang) {
  const merged = {};
  const origin = {};
  if (!dir || !fs.existsSync(dir)) return { merged, origin };
  for (const p of listLocPakFiles(dir, false)) {
    if (!new RegExp(`^${lang}$`, 'i').test(p.language)) continue;
    const { strings } = readLocPak(p.file);
    for (const [k, v] of Object.entries(strings)) {
      merged[k] = v;
      (origin[k] ??= []).push(path.basename(dir));
    }
  }
  return { merged, origin };
}
const vendorEn = loadStrings(PKG, 'en-US');
const vendorZh = loadStrings(PKG, 'zh-CN');
const baseEn = loadStrings(BASE, 'en-US');
const baseZh = loadStrings(BASE, 'zh-CN');

function resolve(key) {
  const en = key in vendorEn.merged ? { v: vendorEn.merged[key], src: 'vendor' } : key in baseEn.merged ? { v: baseEn.merged[key], src: 'base' } : null;
  const zh = key in vendorZh.merged ? { v: vendorZh.merged[key], src: 'vendor' } : key in baseZh.merged ? { v: baseZh.merged[key], src: 'base' } : null;
  let zhStatus;
  if (!zh) zhStatus = 'absent';
  else if (zh.v === '') zhStatus = 'empty';
  else if (en && zh.v === en.v) zhStatus = 'identical';
  else if (hasCjk(zh.v)) zhStatus = 'translated';
  else zhStatus = 'non-cjk';
  return { en, zh, zhStatus, enText: en?.v ?? null };
}

const records = [];
for (const [key, meta] of keyRefs) {
  if (key.includes('#')) {
    records.push({ key, zhStatus: 'unexpanded', enAvailable: false, enText: null, zhText: null, zhSource: null, enSource: null, count: meta.count, tags: [...meta.tags], files: [...meta.files] });
    continue;
  }
  const r = resolve(key);
  records.push({
    key,
    zhStatus: r.zhStatus,
    enAvailable: !!r.en,
    enText: r.enText,
    zhText: r.zh?.v ?? null,
    zhSource: r.zh?.src ?? null,
    enSource: r.en?.src ?? null,
    count: meta.count,
    tags: [...meta.tags],
    files: [...meta.files],
  });
}
records.sort((a, b) => b.count - a.count);

const tally = {};
for (const r of records) tally[r.zhStatus] = (tally[r.zhStatus] ?? 0) + 1;
const dead = records.filter((r) => !r.enAvailable && r.zhStatus !== 'unexpanded');
const nsTally = {};
const ZERO = { total: 0, translated: 0, identical: 0, empty: 0, absent: 0, 'non-cjk': 0, unexpanded: 0 };
for (const r of records) {
  const ns = r.key.startsWith('@') ? '@TT_Package' : r.key.split('.').slice(0, 2).join('.');
  nsTally[ns] ??= { ...ZERO };
  nsTally[ns][r.zhStatus] = (nsTally[ns][r.zhStatus] ?? 0) + 1;
  nsTally[ns].total++;
}

console.log(`# ${path.basename(PKG)}`);
console.log(`# xml=${xml.length} relevant=${sources.size} templates=${templates.size} tooltip-values=${found.length}`);
console.log(`# vendor locPak en-US=${Object.keys(vendorEn.merged).length} zh-CN=${Object.keys(vendorZh.merged).length} | fs-base en=${Object.keys(baseEn.merged).length} zh=${Object.keys(baseZh.merged).length}`);
console.log(`# referenced tooltip KEYS: ${records.length}  ->  ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ')}`);
for (const [ns, t] of Object.entries(nsTally).sort((a, b) => b[1].total - a[1].total).slice(0, SHOW))
  console.log(`     ${ns.padEnd(34)} ${String(t.total).padEnd(6)} translated=${t.translated} identical=${t.identical} absent=${t.absent} empty=${t.empty} nonCJK=${t['non-cjk']}`);
console.log(`# keys with NO English text anywhere (dead/misspelled/unexpanded): ${dead.length}`);
for (const d of dead.slice(0, SHOW)) console.log(`     ${d.key}   [${d.tags.join(',')}] x${d.count} ${[...d.files].slice(0, 1)}`);
console.log(`# hardcoded LITERAL tooltips (need XML shadowing, not a locPak): ${literals.size}`);
for (const [v, e] of [...literals].sort((a, b) => b[1].count - a[1].count).slice(0, SHOW))
  if (v !== '__UNRESOLVED__') console.log(`     x${String(e.count).padEnd(5)} [${[...e.tags].join(',')}] ${v.slice(0, 90)}`);

if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        pkg: PKG,
        base: BASE,
        tally,
        keys: records,
        literals: [...literals].filter(([k]) => k !== '__UNRESOLVED__').map(([value, e]) => ({ value, count: e.count, tags: [...e.tags], files: [...e.files] })),
        counts: { xml: xml.length, values: found.length, keys: records.length, literals: literals.size },
      },
      null,
      2
    )
  );
  console.log(`# wrote ${jsonOut}`);
}
