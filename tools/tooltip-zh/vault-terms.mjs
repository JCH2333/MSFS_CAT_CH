/**
 * Terminology check against the user's C:\ Obsidian aviation vault.
 *
 * The vault is the authoritative Chinese source for this project (per user instruction
 * 2026-09-24): wiki/concepts holds one page per system (空客-电气系统, 空客-防火系统,
 * 空客-防冰防雨, 空客-灯光 ...), wiki/sources holds per-type FCOM extracts
 * (空客A320-FCOM-东航, 空客A350-FCOM-CES, 空客A380-FCOM-官方, 麦道MD-11-FCOM-官方,
 * 商飞C919-FCOM-东航), and raw/ holds the manuals themselves.
 *
 * Session transcripts under .obsidian/ .claudian/ Agent Client/ are EXCLUDED on purpose:
 * they contain this project's own past output, which would make a term look "confirmed"
 * by circular reasoning.
 *
 *   node tools/tooltip-zh/vault-terms.mjs "master caution" "cross feed" ...
 *   node tools/tooltip-zh/vault-terms.mjs --page 电气 --list
 */
import fs from 'node:fs';
import path from 'node:path';

const VAULT = process.env.VAULT || 'C:/Users/Administrator/Documents/Obsidian Vault';
const EXCLUDE = /(^|[\\/])(\.obsidian|\.claudian|\.claude|\.playwright-mcp|\.trash|Agent Client|assets)([\\/]|$)/;

const pages = [];
(function walk(dir, depth = 0) {
  if (depth > 4) return;
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (EXCLUDE.test(full.replace(/\\/g, '/'))) continue;
    if (e.isDirectory()) walk(full, depth + 1);
    else if (/\.(md|txt)$/i.test(e.name) && fs.statSync(full).size < 8_000_000) pages.push(full);
  }
})(VAULT);

const texts = new Map();
function text(f) {
  if (!texts.has(f)) {
    try {
      texts.set(f, fs.readFileSync(f, 'utf8'));
    } catch {
      texts.set(f, '');
    }
  }
  return texts.get(f);
}

const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  const needle = argv.includes('--page') ? argv[argv.indexOf('--page') + 1] : '';
  for (const p of pages) {
    const rel = path.relative(VAULT, p);
    if (!needle || rel.toLowerCase().includes(needle.toLowerCase())) console.log(rel);
  }
  console.log(`# ${pages.length} pages indexed`);
  process.exit(0);
}

const terms = argv.filter((a) => !a.startsWith('--'));
if (!terms.length) {
  console.error('usage: vault-terms.mjs "term" ["term"...] | --page <substr> --list');
  process.exit(2);
}

function findCn(term) {
  const isAbbr = /^[A-Z][A-Z0-9/.+-]{1,9}$/.test(term.trim());
  const words = term.trim().toLowerCase().split(/\s+/);
  const hits = [];
  for (const p of pages) {
    const t = text(p);
    if (!t) continue;
    const lines = t.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      const ok = words.every((w) => low.includes(w));
      if (!ok) continue;
      const line = lines[i].replace(/\s+/g, ' ').trim();
      if (line.length > 320) continue;
      if (/^(https?:|coui:|file:)/.test(line)) continue;
      hits.push({ page: path.relative(VAULT, p), line: i + 1, text: line });
      if (hits.length >= 4) return hits;
      if (isAbbr && hits.length >= 2) return hits;
    }
  }
  return hits;
}

for (const term of terms) {
  console.log(`\n### ${term}`);
  const hits = findCn(term);
  if (!hits.length) {
    console.log('    (vault 无命中 — 需要另找证据或保留英文)');
    continue;
  }
  for (const h of hits) console.log(`    [${h.page}:${h.line}] ${h.text.slice(0, 200)}`);
}
