/**
 * Extract hardcoded <TooltipID>/<TOOLTIPID> literals from a vendor package's behavior XMLs.
 * Case-insensitive element match (PMDG/iFly use TooltipID, TFDi MD-11 uses TOOLTIPID).
 * Output: .local-lab/tooltip/hardcoded-<name>.json
 *   { pkg, files: {relPath: literalCount}, literals: [{value, count, files}] }
 *
 *   node tools/tooltip-zh/extract-hardcoded.mjs <name> <vendorPkg>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const NAME = process.argv[2];
const PKG = path.resolve(process.argv[3]);
if (!NAME || !PKG || !fs.existsSync(PKG)) {
  console.error('usage: extract-hardcoded.mjs <name> <vendorPkg>');
  process.exit(2);
}

const RE = /<tooltipid>([^<]*)<\/tooltipid>/gi;
const tally = new Map();
const files = {};
let scanned = 0;

const walk = (dir, rel = '') => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue;
    const abs = path.join(dir, ent.name);
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walk(abs, r);
    else if (/\.xml$/i.test(ent.name)) {
      scanned++;
      const text = fs.readFileSync(abs, 'utf8');
      const hits = [...text.matchAll(RE)].map((m) => m[1].trim()).filter(Boolean);
      if (hits.length) {
        files[r] = hits.length;
        for (const h of hits) {
          const t = tally.get(h) ?? { value: h, count: 0, files: [] };
          t.count++;
          if (!t.files.includes(r)) t.files.push(r);
          tally.set(h, t);
        }
      }
    }
  }
};
for (const sub of ['SimObjects', 'ModelBehaviorDefs']) {
  const d = path.join(PKG, sub);
  if (fs.existsSync(d)) walk(d, sub);
}

const literals = [...tally.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
// pristine base hashes of every file carrying tooltips (integrity gate for later injection)
const base = {};
for (const rel of Object.keys(files)) {
  const abs = path.join(PKG, rel);
  base[rel] = { sha256: crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'), bytes: fs.statSync(abs).size };
}
const out = { pkg: PKG.replace(/\\/g, '/'), scanned, fileCount: Object.keys(files).length, files, base, literals };
const dst = path.resolve(import.meta.dirname, '../../.local-lab/tooltip', `hardcoded-${NAME}.json`);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(out, null, 1));
console.log(`# ${NAME}: scanned ${scanned} xml files, ${Object.keys(files).length} files with tooltips, ${literals.length} unique literals (${literals.reduce((a, l) => a + l.count, 0)} instances)`);
for (const f of Object.keys(files).slice(0, 12)) console.log(`   ${files[f].toString().padStart(4)}  ${f}`);
