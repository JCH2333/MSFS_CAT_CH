/**
 * Cockpit-tooltip reference extractor (read-only evidence chain).
 *
 * The hover bubble in a 3D cockpit arrives by at least THREE routes and only the first
 * two can be fixed with a .locPak:
 *
 *   key      <TooltipID>TT:FNX320.TOOLTIPS.X.PRESS</TooltipID>      -> needs vendor zh-CN.locPak
 *            <IE_TOOLTIP_DESCRIPTION_ID>@TT_Package.ACTION.OPEN</>  -> package-relative key
 *            <IE_...>COCKPIT.TOOLTIPSV3.ACTION.OPEN_CLOSE</...>     -> base-game key, usually already zh
 *   literal  <TooltipID>Battery Guard</TooltipID>                   -> only fixable by shadowing the XML
 *   token    <ANIMTIP_0>PRESS</ANIMTIP_0>                           -> template parameter, not display text
 *
 * Keys are usually assembled by ModelBehaviour templates ("<TooltipID>TT:NS.#ANIM_NAME#.#ANIMTIP#")
 * so this drives mb.mjs, the template interpreter, rather than grepping.
 *
 *   node tools/tooltip-zh/extract-refs.mjs <packageDir> [--json out.json] [--verbose] [--top N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles, listLocPakFiles, readLocPak, isTooltipKey } from './lib.mjs';
import { parseTemplates, findUses, resolveTooltipValues, TOOLTIP_TAGS } from './mb.mjs';

const argv = process.argv.slice(2);
const PKG = argv.find((a) => !a.startsWith('--'));
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const verbose = argv.includes('--verbose');
const TOP = argv.includes('--top') ? +argv[argv.indexOf('--top') + 1] : 10;
if (!PKG) {
  console.error('usage: extract-refs.mjs <packageDir> [--json out.json] [--verbose]');
  process.exit(2);
}

const BARE_KEY = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+){1,}$/;
const KEY_IN_TEXT = /((?:@?TT:|@TT_Package\.)([A-Za-z0-9_.#-]+))/g;

function classify(v) {
  if (!v) return 'empty';
  if (/(?:@?TT:|@TT_Package\.)/.test(v)) return 'key';
  if (BARE_KEY.test(v)) return isTooltipKey(v) ? 'bare-key' : 'bare-token';
  if (/^[A-Z][A-Z0-9_]*$/.test(v)) return 'token';
  if (/#\w+#/.test(v)) return 'unresolved';
  return 'literal';
}

// ---- load only XML that can matter (template definitions + tooltip-bearing behaviour files)
const allXml = walkFiles(PKG, (n) => /\.xml$/i.test(n));
const sources = new Map();
for (const f of allXml) {
  let t;
  try {
    t = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (/<Template\s+Name=/i.test(t) || /<UseTemplate/i.test(t) || TOOLTIP_TAGS.some((g) => new RegExp(`<${g}\\b`, 'i').test(t)))
    sources.set(f, t);
}
const templates = parseTemplates(sources);

// ---- resolve
const values = [];
const missingTemplates = new Map();
for (const [f, text] of sources) {
  const outside = text.replace(/<Template\s+Name="[^"]+"[\s\S]*?<\/Template>/gi, '');
  for (const use of findUses(outside)) {
    if (!templates.get(use.name)) {
      missingTemplates.set(use.name, (missingTemplates.get(use.name) ?? 0) + 1);
      continue;
    }
    for (const r of resolveTooltipValues(templates, use.name, use.block)) values.push({ ...r, from: path.relative(PKG, f) });
  }
  // tooltips written straight into the behaviour file, no template involved
  for (const tag of TOOLTIP_TAGS) {
    const re = new RegExp(`<${tag}(?:\\s[^>/]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
    for (const m of outside.matchAll(re)) {
      const v = m[1].replace(/\s+/g, ' ').trim();
      if (v && !v.includes('<')) values.push({ file: f, tag, value: v, via: '(direct)', from: path.relative(PKG, f), missing: [] });
    }
  }
}

// ---- aggregate
const keyMap = new Map();
const literals = new Map();
const unresolved = new Map();
const kinds = new Map();
for (const r of values) {
  const k = classify(r.value);
  kinds.set(k, (kinds.get(k) ?? 0) + 1);
  const keys = [...r.value.matchAll(KEY_IN_TEXT)].map((m) => (m[1].startsWith('@TT_Package.') ? m[1] : m[2]));
  if (k === 'bare-key' || k === 'bare-token') keys.push(r.value);
  for (const key of keys) {
    if (/#\w+#/.test(key)) {
      unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
      continue;
    }
    if (!keyMap.has(key)) keyMap.set(key, { count: 0, files: new Set(), tags: new Set() });
    const e = keyMap.get(key);
    e.count++;
    e.files.add(r.from);
    e.tags.add(r.tag);
  }
  if (k === 'literal') {
    if (!literals.has(r.value)) literals.set(r.value, { count: 0, files: new Set(), tags: new Set() });
    const e = literals.get(r.value);
    e.count++;
    e.files.add(r.from);
    e.tags.add(r.tag);
  }
}

// ---- vendor locPak cross-check
let pakReport = null;
for (const p of listLocPakFiles(PKG)) {
  if (!/^en-us$/i.test(p.language)) continue;
  const { strings } = readLocPak(p.file);
  const tooltipKeys = Object.keys(strings).filter(isTooltipKey);
  const refSet = new Set(keyMap.keys());
  const bare = [...refSet].filter((k) => !k.includes('.'));
  pakReport = {
    file: p.file,
    totalKeys: Object.keys(strings).length,
    tooltipKeys: tooltipKeys.length,
    nonTooltipKeys: Object.keys(strings).length - tooltipKeys.length,
    referencedButMissing: [...refSet].filter((k) => !(k in strings)),
    inLocPakButNeverReferenced: tooltipKeys.filter((k) => !refSet.has(k)),
    oddReferences: bare,
  };
}

const prefixOf = (k) => (k.startsWith('@TT_Package.') ? '@TT_Package' : k.split('.').slice(0, 2).join('.'));
const byPrefix = new Map();
for (const k of keyMap.keys()) byPrefix.set(prefixOf(k), (byPrefix.get(prefixOf(k)) ?? 0) + 1);
const litPrefixes = new Map();
for (const k of literals.keys()) {
  const p = BARE_KEY.test(k) ? prefixOf(k) : '(sentence)';
  litPrefixes.set(p, (litPrefixes.get(p) ?? 0) + 1);
}

console.log(`# ${path.basename(PKG)}`);
console.log(`# xml=${allXml.length} (relevant=${sources.size})  templates=${templates.size}  tooltip values=${values.length}`);
console.log(`# value kinds: ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`# distinct KEYS referenced: ${keyMap.size}`);
for (const [p, c] of [...byPrefix].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`     ${p}  (${c})`);
console.log(`# LITERAL tooltip strings (no key): ${literals.size}`);
for (const [p, c] of [...litPrefixes].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`     ${p}  (${c})`);
if (unresolved.size) {
  console.log(`# keys still holding #PLACEHOLDER# after expansion: ${unresolved.size}`);
  for (const [k, c] of [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, verbose ? 40 : 6)) console.log(`     ${k} x${c}`);
}
if (missingTemplates.size)
  console.log(`# UseTemplate with no definition in this package: ${missingTemplates.size} -> ${[...missingTemplates.keys()].slice(0, 6).join(', ')}`);
if (pakReport) {
  console.log(
    `# vendor en-US.locPak: ${pakReport.totalKeys} keys (${pakReport.tooltipKeys} tooltip / ${pakReport.nonTooltipKeys} other) | ` +
      `referenced-but-missing ${pakReport.referencedButMissing.length} | never-referenced ${pakReport.inLocPakButNeverReferenced.length}`
  );
  if (verbose) {
    for (const k of pakReport.referencedButMissing.slice(0, 40)) console.log(`   MISSING  ${k}  <- ${[...keyMap.get(k)?.files ?? []].slice(0, 2).join(',')}`);
    for (const k of pakReport.inLocPakButNeverReferenced.slice(0, 40)) console.log(`   UNREF    ${k}`);
  }
}
if (verbose && literals.size) {
  console.log('\n## literal sample');
  let n = 0;
  for (const [v, e] of [...literals].sort((a, b) => b[1].count - a[1].count)) {
    if (n++ > 40) break;
    console.log(`   x${e.count} [${[...e.tags].join(',')}] ${v.slice(0, 120)}`);
  }
}

if (jsonOut) {
  const strip = (m) => [...m].map(([k, v]) => ({ value: k, count: v.count, files: [...v.files], tags: [...v.tags] }));
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      { pkg: PKG, xml: allXml.length, templates: templates.size, kinds: Object.fromEntries(kinds), keys: strip(keyMap), literals: strip(literals), unresolved: [...unresolved], locPak: pakReport },
      null,
      2
    )
  );
  console.log(`# wrote ${jsonOut}`);
}
