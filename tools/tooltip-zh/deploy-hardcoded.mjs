/**
 * Deploy hardcoded-tooltip shadow files into the per-aircraft zzz- overlay packages.
 *
 * The vendor behavior XMLs are NEVER touched: each affected file is copied from the
 * vendor package with <TooltipID>/<TOOLTIPID> literals replaced per the generated
 * dictionary, then registered in the OVERLAY package's layout.json. Restore = remove the
 * overlay entries/files (or fill-vendor-style backups are unnecessary here by design).
 * Vendor base hashes are recorded for future rebase checks (GSX 事故后的铁律).
 *
 *   node tools/tooltip-zh/deploy-hardcoded.mjs <pmdg-737|ifly-737max|tfdi-md11> [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { layoutUpsert, filetime18, validateLayout, writeCommunityPackage } from './pack.mjs';

const NAME = process.argv[2];
const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '../..');
const LAB = path.join(ROOT, '.local-lab/tooltip');

const TARGETS = {
  'pmdg-737': {
    vendor: 'F:/games/community/Community2024/pmdg-aircraft-737',
    overlay: 'F:/games/community/Community2024/zzz-JCH-pmdg-efb-zh-patch',
  },
  'ifly-737max': {
    vendor: 'F:/games/community/Community/ifly-aircraft-737max8',
    overlay: 'F:/games/community/Community/zzz-JCH-ifly-cockpit-zh-patch', // new standalone overlay
  },
  'tfdi-md11': {
    vendor: 'F:/games/community/Community/tfdidesign-aircraft-md11',
    overlay: 'F:/games/community/Community/zzz-JCH-tfdi-md11-efb-zh-patch',
  },
};

if (!NAME || !TARGETS[NAME]) {
  console.error('usage: deploy-hardcoded.mjs <pmdg-737|ifly-737max|tfdi-md11> [--dry]');
  process.exit(2);
}
const { vendor: VENDOR, overlay: OVERLAY } = TARGETS[NAME];
const corpus = JSON.parse(fs.readFileSync(path.join(LAB, `hardcoded-${NAME}.json`), 'utf8'));
const { dict } = JSON.parse(fs.readFileSync(path.join(LAB, `dict-hardcoded-${NAME}.json`), 'utf8'));
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// base hashes of every vendor file we shadow (rebase tracking across vendor updates)
const baseFile = path.join(LAB, `hardcoded-${NAME}.base.json`);
const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : {};
const vendorBase = base.vendorBase ?? {};

const RE = /(<tooltipid>)([^<]*)(<\/tooltipid>)/gi;
let totalReplaced = 0;
const newFiles = [];

for (const [rel, expected] of Object.entries(corpus.files)) {
  const vendorAbs = path.join(VENDOR, rel);
  if (!fs.existsSync(vendorAbs)) {
    console.error(`REFUSED: vendor base file missing: ${rel}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(vendorAbs, 'utf8');
  let count = 0;
  const out = raw.replace(RE, (whole, open, inner, close) => {
    const key = inner.trim();
    const zh = dict[key];
    if (zh === undefined) return whole; // unknown literal — the count gate below refuses
    count++; // replaced OR deliberately preserved (zh === key)
    return `${open}${zh}${close}`;
  });
  if (count !== expected) {
    console.error(`REFUSED: ${rel} expected ${expected} replacements, made ${count} — dictionary/file drift`);
    process.exit(1);
  }
  vendorBase[rel] = { sha256: sha256(vendorAbs), bytes: fs.statSync(vendorAbs).size };
  totalReplaced += count;
  newFiles.push({ rel, content: out });
}

console.log(`# ${NAME}: ${newFiles.length} shadow files, ${totalReplaced} tooltip strings replaced`);
if (DRY) {
  for (const f of newFiles) console.log(`   would shadow: ${f.rel}`);
  process.exit(0);
}

// record base hashes BEFORE deploying
fs.writeFileSync(baseFile, JSON.stringify({ vendorBase }, null, 1));

const standalone = NAME === 'ifly-737max' && !fs.existsSync(path.join(OVERLAY, 'manifest.json'));

if (standalone) {
  // brand-new overlay: write everything in one shot (avoids splicing into an empty layout)
  const payload = Object.fromEntries(newFiles.map((f) => [f.rel, f.content]));
  writeCommunityPackage(OVERLAY, {
    manifest: { title: 'iFly 737MAX Cockpit Chinese Patch', version: '0.1.0' },
    contentType: 'UNKNOWN',
    files: payload,
  });
  const v0 = validateLayout(OVERLAY);
  console.log(`# created standalone overlay package: ${newFiles.length} files, entries=${v0.entries}, valid=${v0.ok}`);
  if (!v0.ok) console.log(v0.errors.slice(0, 10).map((e) => '   ' + e).join('\n'));
  process.exit(0);
}

for (const f of newFiles) {
  const dst = path.join(OVERLAY, f.rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, f.content);
}

// register in the overlay layout.json (text splice; existing entries untouched)
const layoutPath = path.join(OVERLAY, 'layout.json');
const text = fs.readFileSync(layoutPath, 'utf8');
const entries = newFiles.map((f) => ({
  path: f.rel,
  size: fs.statSync(path.join(OVERLAY, f.rel.replace(/\//g, path.sep))).size,
  date: filetime18(fs.statSync(path.join(OVERLAY, f.rel.replace(/\//g, path.sep))).mtimeMs),
}));
const next = layoutUpsert(text, entries, '        ');
fs.writeFileSync(layoutPath, next);

const v = validateLayout(OVERLAY);
console.log(`# deployed into ${path.basename(OVERLAY)}: layout entries now ${v.entries}, valid=${v.ok}`);
if (!v.ok) console.log(v.errors.slice(0, 10).map((e) => '   ' + e).join('\n'));
