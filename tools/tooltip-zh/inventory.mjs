/**
 * Stage-1 inventory: for every Community package, report the tooltip slice of its
 * localisation packages and how complete each language is.
 *
 * Read-only. Writes nothing unless --json <file>.
 *
 *   node tools/tooltip-zh/inventory.mjs [--root F:/games/community/Community]
 *                                       [--filter a,b,c] [--json out.json] [--all]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  listLocPakFiles,
  readLocPak,
  isTooltipKey,
  auditLanguage,
  namespaceHistogram,
  suffixHistogram,
  controlOf,
} from './lib.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const ROOT = arg('root', 'F:/games/community/Community');
const FILTER = (arg('filter', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = arg('json', null);

function packages() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !FILTER.length || FILTER.some((f) => n.toLowerCase().includes(f.toLowerCase())));
}

const rows = [];
for (const name of packages()) {
  const dir = path.join(ROOT, name);
  const paks = listLocPakFiles(dir);
  if (!paks.length) continue;
  const parsed = new Map();
  for (const p of paks) {
    const r = readLocPak(p.file);
    parsed.set(p.language.toLowerCase(), { ...r, file: p.file, declared: r.language });
  }
  const en = parsed.get('en-us') ?? parsed.get('en-gb') ?? parsed.get('en');
  if (!en) {
    rows.push({ name, note: `has ${paks.length} locPak but no en-US`, langs: [...parsed.keys()] });
    continue;
  }
  const enKeys = Object.keys(en.strings);
  const enTooltipKeys = enKeys.filter(isTooltipKey);
  const row = {
    name,
    langs: [...parsed.keys()],
    totalKeys: enKeys.length,
    tooltipKeys: enTooltipKeys.length,
    tooltipNamespaces: namespaceHistogram(enTooltipKeys, 2).slice(0, 6).map(([k, v]) => `${k} (${v})`),
    controls: new Set(enTooltipKeys.map(controlOf)).size,
    suffixes: suffixHistogram(enTooltipKeys).slice(0, 8).map(([k, v]) => `${k}:${v}`),
    languages: {},
  };
  for (const [lang, pack] of parsed) {
    if (lang === 'en-us' || lang === 'en-gb') continue;
    const tKeys = Object.keys(pack.strings).filter(isTooltipKey);
    if (!tKeys.length) continue;
    const enTooltips = Object.fromEntries(enTooltipKeys.map((k) => [k, en.strings[k]]));
    const targetTooltips = Object.fromEntries(tKeys.map((k) => [k, pack.strings[k]]));
    const { buckets } = auditLanguage(enTooltips, targetTooltips);
    row.languages[lang] = {
      tooltipKeys: tKeys.length,
      translated: buckets.translated.length,
      latinOnly: buckets.latin.length,
      identical: buckets.identical.length,
      empty: buckets.empty.length,
      missing: buckets.missing.length,
    };
  }
  rows.push(row);
}

const fmt = (r) => {
  const zh = r.languages?.['zh-cn'];
  const lines = [];
  lines.push(`■ ${r.name}`);
  if (r.note) lines.push(`    ${r.note}  langs=${(r.langs ?? []).join(',')}`);
  if (r.totalKeys == null) return lines.join('\n');
  lines.push(
    `    en-US: ${r.totalKeys} keys, ${r.tooltipKeys} tooltip keys across ${r.controls} controls` +
      `  [ns: ${r.tooltipNamespaces.join(', ') || '-'}]`
  );
  lines.push(`    suffixes: ${r.suffixes.join(' ')}`);
  if (zh) {
    lines.push(
      `    zh-CN : ${zh.tooltipKeys} tooltip keys -> translated ${zh.translated} / identical ${zh.identical}` +
        ` / empty ${zh.empty} / non-CJK ${zh.latinOnly} / missing ${zh.missing}`
    );
  } else {
    lines.push('    zh-CN : ABSENT (vendor ships no Chinese localisation package)');
  }
  const others = Object.entries(r.languages ?? {}).filter(([l]) => l !== 'zh-cn');
  if (others.length) {
    lines.push(`    other langs: ${others.map(([l, v]) => `${l}=${v.translated}/${v.tooltipKeys}`).join(' ')}`);
  }
  return lines.join('\n');
};

const interesting = rows.filter((r) => {
  if (!r.totalKeys) return false;
  if (process.argv.includes('--all')) return true;
  const zh = r.languages?.['zh-cn'];
  return (r.tooltipKeys ?? 0) > 0 && (!zh || zh.missing + zh.identical + zh.empty > 0);
});

console.log(`# Community locPak / tooltip inventory — ${ROOT}`);
console.log(`# packages scanned: ${rows.length}, with tooltip keys needing work: ${interesting.length}\n`);
for (const r of interesting) console.log(fmt(r) + '\n');
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({ root: ROOT, rows }, null, 2));
  console.log(`# wrote ${OUT}`);
}
