/**
 * Remove ineffective shadow files (and their layout entries) from an overlay package.
 * Used after the PMDG/MD-11 shadow approach proved ineffective (relative includes resolve
 * inside the vendor package); iFly's working standalone overlay is NOT touched.
 *
 *   node tools/tooltip-zh/undeploy-hardcoded.mjs <pmdg-737|tfdi-md11>
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateLayout } from './pack.mjs';

const NAME = process.argv[2];
const ROOT = path.resolve(import.meta.dirname, '../..');
const TARGETS = {
  'pmdg-737': 'F:/games/community/Community2024/zzz-JCH-pmdg-efb-zh-patch',
  'tfdi-md11': 'F:/games/community/Community/zzz-JCH-tfdi-md11-efb-zh-patch',
};
if (!NAME || !TARGETS[NAME]) {
  console.error('usage: undeploy-hardcoded.mjs <pmdg-737|tfdi-md11>');
  process.exit(2);
}
const overlay = TARGETS[NAME];
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, '.local-lab/tooltip', `hardcoded-${NAME}.json`), 'utf8'));
const rels = Object.keys(corpus.files);

let removed = 0;
for (const rel of rels) {
  const abs = path.join(overlay, rel.replace(/\//g, path.sep));
  if (fs.existsSync(abs)) {
    fs.rmSync(abs);
    removed++;
  }
}
// prune directories left empty by the removals
const prune = (d) => {
  let empty = true;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) {
      if (prune(full)) fs.rmdirSync(full);
      else empty = false;
    } else empty = false;
  }
  return empty;
};
for (const rel of rels) {
  let d = path.dirname(path.join(overlay, rel.replace(/\//g, path.sep)));
  while (d !== overlay) {
    if (fs.existsSync(d) && prune(d)) d = path.dirname(d);
    else break;
  }
}

// strip the corresponding layout entries textually (FILETIME values must not round-trip)
const layoutPath = path.join(overlay, 'layout.json');
let text = fs.readFileSync(layoutPath, 'utf8');
const byLower = new Map(rels.map((r) => [r.toLowerCase(), r]));
const entryRe = /\s*\{[^{}]*?"path"\s*:\s*"([^"]+)"[^{}]*?\}(?:,)?/g;
text = text.replace(entryRe, (whole, p) => (byLower.has(p.toLowerCase()) ? '' : whole));
text = text.replace(/,\s*,/g, ',').replace(/,\s*\]/g, '\n}');
fs.writeFileSync(layoutPath, text);

const parsed = JSON.parse(text);
const v = validateLayout(overlay);
console.log(`# ${NAME}: removed ${removed} shadow files; layout entries now ${parsed.content.length}, valid=${v.ok}`);
if (!v.ok) console.log(v.errors.slice(0, 5).map((e) => '   ' + e).join('\n'));
process.exit(0);
