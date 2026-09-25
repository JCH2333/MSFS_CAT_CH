/**
 * Dictionary generator for HARDCODED cockpit-tooltip literals (PMDG 737 / iFly 737MAX / TFDi MD-11).
 *
 * Three regimes in one pass:
 *   plain     — whole-string compile over termbase + authored EXACT + rules frames (PMDG, iFly)
 *   macro     — MD-11 style RPN templates: the literal is split into macro tokens
 *               (%((...))%, %{...}, %!d!%% ...) which pass through untouched, and text
 *               segments between them which are translated individually; reassembled 1:1.
 *
 * Evidence discipline is the same as the locPak work: termbase (real pairs) → authored EXACT
 * → frames with SUBJECTS; anything unresolved lands in todo and is NOT invented.
 *
 *   node tools/tooltip-zh/gen-hardcoded.mjs <name>          # build dict-hardcoded-<name>.json + todo file
 */
import fs from 'node:fs';
import path from 'node:path';
import { compile, loadTermbase, siblingLayer } from './dict-engine.mjs';
import { PRESERVE, SUBJECTS, CLASS_VERBS, subj } from './rules-common.mjs';

const NAME = process.argv[2];
if (!NAME) {
  console.error('usage: gen-hardcoded.mjs <pmdg-737|ifly-737max|tfdi-md11>');
  process.exit(2);
}
const ROOT = path.resolve(import.meta.dirname, '../..');
const LAB = path.join(ROOT, '.local-lab/tooltip');
const src = JSON.parse(fs.readFileSync(path.join(LAB, `hardcoded-${NAME}.json`), 'utf8'));

// authored tables live next to this script; they may be partial while the todo loop runs
// the 738 shares the 737 cockpit strings — reuse the 737 authored tables
const AUTHOR = NAME === 'pmdg-738' ? 'pmdg-737' : NAME;
const authoredFile = path.join(import.meta.dirname, `authored-hardcoded-${AUTHOR}.mjs`);
const authored = fs.existsSync(authoredFile) ? (await import(`file://${authoredFile.replace(/\\/g, '/')}`)).default : {};
// large plain-string tables live as JSON siblings (<AUTHOR>.extra.json) and merge into EXACT
const extraFile = path.join(import.meta.dirname, `authored-hardcoded-${AUTHOR}.extra.json`);
const extra = fs.existsSync(extraFile) ? JSON.parse(fs.readFileSync(extraFile, 'utf8')) : {};
if (extra && Object.keys(extra).length) {
  authored.EXACT = { ...(authored.EXACT ?? {}), ...extra };
}

const tb = loadTermbase();
const rules = {
  PRESERVE: [...PRESERVE, ...(authored.PRESERVE ?? [])],
  EXACT: authored.EXACT ?? {},
  SUBJECTS,
  PATTERNS: authored.PATTERNS ?? [],
};

/** split an RPN-template literal into [{macro:true,text}|{macro:false,text}] */
function segment(literal) {
  const parts = [];
  // MSFS RPN template tokens. Delimiters are SHARED between consecutive macros
  // (%((X))%{if} — the single % closes the RPN block and opens the conditional), so the
  // tokenizer must accept %-less brace tokens and bare format suffixes (!1.1f!).
  const re = /(%\(\([^%]*?\)%|%[^%\(]?\([^%]*?\)%|%!\S*?!?|%\.?\d+!?%|%%|%?\{(?:if|else|end|case|:[\d.]+)\}|!\d?(?:\.\d+)?[fd]!)/g;
  let last = 0;
  for (const m of literal.matchAll(re)) {
    if (m.index > last) parts.push({ macro: false, text: literal.slice(last, m.index) });
    parts.push({ macro: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < literal.length) parts.push({ macro: false, text: literal.slice(last) });
  return parts;
}

// segment-level dictionary: built from the union of everything we already trust
const segmentDict = new Map();
{
  const rulesExact = rules.EXACT ?? {};
  for (const [k, v] of Object.entries(rulesExact)) segmentDict.set(k.toLowerCase(), v);
  for (const [k, v] of tb) segmentDict.set(k.toLowerCase(), v);
  for (const [k, v] of Object.entries(authored.SEGMENTS ?? {})) segmentDict.set(k.toLowerCase(), v);
}
const segPatterns = (authored.SEG_PATTERNS ?? []).map(([re, fn]) => [new RegExp(re, 'i'), fn]);
/** segment resolution order: authored flat map → authored patterns → termbase/exact union */
function lookupSegment(seg) {
  const lower = seg.toLowerCase();
  const flat = (authored.SEGMENTS ?? {})[lower];
  if (flat !== undefined) return flat;
  for (const [re, fn] of segPatterns) {
    const m = seg.match(re);
    if (m) return typeof fn === 'function' ? fn(m, seg) : fn.replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
  }
  return segmentDict.get(lower);
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const source = {};
for (const l of src.literals) source[l.value] = l.value;

const dict = {};
const provenance = {};
const todo = [];
const failedSegments = new Set();

if (NAME === 'tfdi-md11') {
  const staticCompiled = compile(
    Object.fromEntries(Object.keys(source).filter((k) => !/%\(/.test(k)).map((k) => [k, k])),
    rules,
    { termbase: tb }
  );
  const staticDict = staticCompiled.dict;

  for (const lit of src.literals) {
    const value = lit.value;
    if (value === '#TOOLTIPID#') {
      dict[value] = value;
      provenance[value] = 'template-placeholder';
      continue;
    }
    if (!/%\(/.test(value)) {
      if (staticDict[value] !== undefined) {
        dict[value] = staticDict[value];
        provenance[value] = staticCompiled.provenance[value];
      } else todo.push(value);
      continue;
    }
    const wholeExactM = (authored.EXACT ?? {})[norm(value)];
    if (wholeExactM !== undefined) {
      dict[value] = wholeExactM;
      provenance[value] = 'exact';
      continue;
    }
    const parts = segment(value);
    // FLATTEN (2026-09-25 in-game evidence): the native tooltip bubble does NOT expand
    // TFDi's RPN templates — the English originals displayed raw %((...))/%{else}/%{:1}
    // too — so preserving macros buys nothing. Emit a clean static label instead:
    // control name (text before the first macro) + state branches joined with '/'.
    let seenMacro = false;
    const nameZh = [];
    const suffixZh = [];
    const branches = [];
    let failed = null;
    const cleanPiece = (translated) =>
      translated.split('/').map((s) => s.trim()).filter((s) => s && !s.startsWith('°'));
    for (const p of parts) {
      if (p.macro) {
        seenMacro = true;
        continue;
      }
      const seg = norm(p.text);
      if (!seg) continue;
      const zh = lookupSegment(seg);
      if (zh === undefined) {
        failed = failed ?? seg;
        continue;
      }
      const translated = p.text.replace(seg, zh);
      if (!seenMacro) {
        nameZh.push(translated);
      } else if (seg.startsWith(')')) {
        suffixZh.push(translated.replace(/[)）]/g, '').trim());
      } else {
        branches.push(...cleanPiece(translated));
      }
    }
    if (failed !== null) {
      for (const p of parts) {
        if (!p.macro) {
          const seg = norm(p.text);
          if (seg && lookupSegment(seg) === undefined) failedSegments.add(seg);
        }
      }
      todo.push(value);
      continue;
    }
    // the label wrapper adds its own full-width parens; parens inside pieces are noise
    let name = nameZh.join('').replace(/[（）()]/g, '').replace(/\s+/g, ' ').trim();
    if (suffixZh.length) name = (name + ' ' + suffixZh.join(' ').replace(/[（）()]/g, '')).replace(/\s+/g, ' ').trim();
    const uniqBranches = [...new Set(branches)].slice(0, 5);
    // literals that START with the state macro ("...%{end} Temperature") carry the control
    // noun as the last branch — promote it so the label reads 温度（主货舱甲板/中客舱）
    if (!name && uniqBranches.length > 1) name = uniqBranches.pop();
    dict[value] = uniqBranches.length ? `${name}（${uniqBranches.join('/')}）` : name;
    provenance[value] = 'flattened';
  }
} else {
  // PMDG/iFly: plain compile, except the few literals that embed RPN macros — those go
  // through the same segment machinery so the surrounding words still translate
  const compiled = compile(
    Object.fromEntries(Object.keys(source).filter((k) => !/%\(/.test(k)).map((k) => [k, k])),
    rules,
    { termbase: tb }
  );
  Object.assign(dict, compiled.dict);
  Object.assign(provenance, compiled.provenance);
  for (const lit of src.literals) {
    const value = lit.value;
    if (dict[value] !== undefined || !/%\(/.test(value)) continue;
    const wholeExact = (authored.EXACT ?? {})[norm(value)];
    if (wholeExact !== undefined) {
      dict[value] = wholeExact;
      provenance[value] = 'exact';
      continue;
    }
    const parts = segment(value);
    const out = [];
    let failed = null;
    for (const p of parts) {
      if (p.macro) {
        out.push(p.text);
        continue;
      }
      const seg = norm(p.text);
      if (!seg) {
        out.push(p.text);
        continue;
      }
      const zh = lookupSegment(seg);
      if (zh !== undefined) out.push(p.text.replace(seg, zh));
      else {
        failed = failed ?? seg;
        out.push(p.text);
      }
    }
    if (failed === null) {
      dict[value] = out.join('');
      provenance[value] = 'macro-segments';
    } else {
      for (const p of parts) {
        if (!p.macro) {
          const seg = norm(p.text);
          if (seg && lookupSegment(seg) === undefined) failedSegments.add(seg);
        }
      }
      todo.push(value);
    }
  }
  todo.push(...compiled.todo.map((t) => t.en));
}

// ---- report ---------------------------------------------------------------------
const byProv = {};
for (const v of Object.values(provenance)) byProv[v] = (byProv[v] ?? 0) + 1;
fs.writeFileSync(path.join(LAB, `dict-hardcoded-${NAME}.json`), JSON.stringify({ dict, provenance }, null, 1));
fs.writeFileSync(path.join(LAB, `todo-hardcoded-${NAME}.txt`), todo.map((t) => t.replace(/\n/g, '\\n')).join('\n'));
if (failedSegments.size) fs.writeFileSync(path.join(LAB, `todo-segments-${NAME}.txt`), [...failedSegments].join('\n'));
console.log(`# ${NAME}: ${src.literals.length} literals -> dict ${Object.keys(dict).length}, todo ${todo.length}, failed segments ${failedSegments.size}`);
console.log(`# provenance: ${JSON.stringify(byProv)}`);
