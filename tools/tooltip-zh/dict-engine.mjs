/**
 * Tooltip dictionary compiler, shared by every aircraft.
 *
 * Resolution order for one English source string (first match wins):
 *
 *   1. PRESERVE   the string must stay English (behaviour-judging tokens, type names,
 *                 brand names, cockpit standard abbreviations). Never translated.
 *   2. EXACT      hand-authored per-aircraft override.
 *   3. TERMBASE   verbatim hit against shipped official/vendor Chinese
 *                 (fs-base + iniBuilds + FBW) -> keeps wording consistent with the rest
 *                 of the Chinese UI.
 *   4. PATTERN    ordered regex templates with named groups, whose noun slots are filled
 *                 from SUBJECTS. Longest/most specific patterns first.
 *   5. SUBJECTS   a bare control name ("Battery 1", "IDG 1") on its own line.
 *   6. TODO       anything left over. The compiler DOES NOT invent a translation:
 *                 leftovers are reported and the build fails on --strict.
 *
 * Every produced value is then checked by audit() for leftover Latin words that are not
 * on the allowlist, for unbalanced parentheses, and for self-expanding abbreviations
 * (an abbreviation whose gloss contains the abbreviation itself would re-bracket every
 * pass — the retanslate-drift defect already seen in the HTML engines).
 *
 *   import { compile } from './dict-engine.mjs';
 */
import fs from 'node:fs';

let termbaseCache = null;
export function loadTermbase(file = '.local-lab/tooltip/termbase.json') {
  if (termbaseCache) return termbaseCache;
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')).exact;
  termbaseCache = new Map(rows.map((r) => [r.en, r.zh]));
  return termbaseCache;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const hasCjk = (s) => /[㐀-鿿]/.test(s);

function balanced(s) {
  const stack = [];
  const pairs = { '(': ')', '（': '）', '[': ']', '【': '】' };
  for (const ch of s) {
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (stack.length && ch === stack[stack.length - 1]) stack.pop();
    else if (')）]】'.includes(ch) && !stack.length) return false;
  }
  return stack.length === 0;
}

/** Words that may legitimately stay Latin inside a Chinese tooltip. */
const DEFAULT_ALLOW = new Set([
  'IDG','APU','VOR','ADF','ILS','MLS','GPS','RNAV','FBW','CUDD','FADEC','EGT','N1','N2','N3','EPR',
  'V1','VR','V2','MTOW','MZFW','ZFW','DWGR','LDG','TO','CRZ','DES','APP','NAV','ATT','FD','FCU','EFIS',
  'ECAM','SD','FMA','PFD','ND','MCDU','FMGC','ELAC','SEC','FAC','PTU','RAT','TR','BTN','LSK','SK','CPT',
  'FO','DH','AH','CH','SI','SM','KG','LB','FT','MIN','SEC','VHF','HF','SAT','SATCOM','DATA','Voice','RMP',
  'TCAS','WX','STORM','GND','CAB','ENG','ENGN','WING','FLEX','TEMP','ADS','RADIO','MAP','CLR','ENT','DEL',
  'ATC','XPNDR','TRANS','MODE','CODE','ISOL','NO','EMER','MASK','MIC','HOT','COLD','WET','DRY','MAN',
  'AUTO','OB','HDG','TRK','HOLD','L','R','C','D','E','F','A','B','1','2','3','4','5','6','7','8','9','0',
  'LVL','CRT','TEST','RESET','ON','OFF','OPEN','CLOSE','ADIRU','ADIRS','IRS','IRS-','DRA','ENG1','ENG2',
  'COM','COM1','COM2','COM3','NAV1','NAV2','BARO','RAD','STD','FT(','PXU','XPU','ZRU','ZLW','ZRW','GT','CVR',
  'FDR','ELT','WXR','SLS','APPR','BND','WPT','AIRW','WAYPTS','FL','SPD','MACH','HDGSEL','ALT','SEL','INT',
  'EXT','PUSH','PULL','TYPE','CLASS','REV','SET','TOGA','MCT','CL','CLB','MGT','CRC','GRND','FLARE','BOCS',
  // IR / ADR / ATT are the ADIRS knob legends themselves, and hPa / inHg / NDB / DME / TACAN
  // are units or station types with no shorter Chinese form.
  'IR','ADR','ATT','IRS','GBAS','FQI','TMR','LOC','CANC','EIS','DMC','CTL','FCTL','SK','ACT','AC',
  'NDB','DME','TACAN','HPA','INHG','MLS','MKR','CVR','FDR','ELT','GPU','RMP','LSK','TCAS','WX',
  'DCDU','FUEL','PRED','VS','FPA','TRK','CPDLC','MACH','FOB','VOR','ILS','RNAV','GPS','APU',
  'ACARS','CMC','ATSU','ACMS','FMGEC','CPMS','CBMU','CTU','PVIS','TFTS','SATCOM','SECU','PRIM','ADK',
  'SURV','EICAS','START','STOP','PUSH','OVR','PNT',
]);

export function compile(source, rules, opts = {}) {
  const tb = opts.termbase ?? loadTermbase();
  const siblings = opts.siblings ?? (opts.pairs ? siblingLayer(opts.pairs) : new Map());
  const allow = new Set([...DEFAULT_ALLOW, ...(opts.allow ?? [])]);
  const preserve = new Set((rules.PRESERVE ?? []).map(norm));
  const exact = new Map(Object.entries(rules.EXACT ?? {}).map(([k, v]) => [norm(k), v]));
  const subjects = new Map(Object.entries(rules.SUBJECTS ?? {}).map(([k, v]) => [norm(k), v]));
  const patterns = (rules.PATTERNS ?? []).map(([re, tpl]) => [typeof re === 'string' ? new RegExp(re, 'i') : re, tpl]);

  const dict = {};
  const todo = [];
  const provenance = {};

  const fillSubjects = (text) =>
    text.replace(/\{(\w+)\}/g, (whole, name) => subjects.get(norm(name)) ?? whole);

  for (const [key, rawEn] of Object.entries(source)) {
    const en = norm(rawEn);
    if (!en) continue;
    if (preserve.has(en)) {
      dict[key] = en;
      provenance[key] = 'preserve';
      continue;
    }
    if (exact.has(en)) {
      dict[key] = exact.get(en);
      provenance[key] = 'exact';
      continue;
    }
    if (tb.has(en)) {
      dict[key] = tb.get(en);
      provenance[key] = 'termbase';
      continue;
    }
    if (siblings.has(en)) {
      dict[key] = siblings.get(en);
      provenance[key] = 'sibling';
      continue;
    }
    let done = false;
    for (const [re, tpl] of patterns) {
      const m = en.match(re);
      if (!m) continue;
      let out = tpl;
      if (typeof out === 'function') out = out(m, en);
      else {
        out = out.replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
        out = fillSubjects(out);
      }
      // an unfilled {slot} means the frame failed — but %{macro} syntax is real content
      if (!out || out === en || /\{\w+\}/.test(out.replace(/%\{[^}]*\}/g, ''))) continue;
      dict[key] = norm(out);
      provenance[key] = 'pattern';
      done = true;
      break;
    }
    if (done) continue;
    if (subjects.has(en)) {
      dict[key] = subjects.get(en);
      provenance[key] = 'subject';
      continue;
    }
    todo.push({ key, en });
  }

  return {
    dict,
    todo,
    provenance,
    allow,
    audit: audit(dict, source, allow, { authored: new Set([...exact.values(), ...Object.values(rules.EXACT ?? {})]) }),
  };
}

/**
 * Sibling inheritance: derive an untranslated label from an already-translated sibling that
 * differs only in its digits.
 *
 * This is evidence, not inference — iniBuilds renders every index as an Arabic digit on BOTH
 * sides ("SET GEN 1" -> 设置发电机1, "SET GEN 2" -> 设置发电机2), so a machine-copied
 * "SET GEN 3" can be completed by substitution with no new terminology decision at all.
 * Only digit-for-digit aligned siblings are used, and the digit positions must match.
 */
export function siblingLayer(pairs) {
  const bySkeleton = new Map();
  for (const { en, zh } of pairs) {
    if (!zh || zh === en) continue;
    const skeleton = en.replace(/\d+/g, '#');
    if (!/\d/.test(en)) continue;
    if (!bySkeleton.has(skeleton)) bySkeleton.set(skeleton, []);
    bySkeleton.get(skeleton).push({ en, zh, digits: en.match(/\d+/g) });
  }
  const derived = new Map();
  for (const [skel, group] of bySkeleton) {
    if (group.length < 2) continue;
    const width = group[0].digits.length;
    if (!group.every((g) => g.digits.length === width)) continue;
    // pick the first sibling whose Chinese keeps one digit in the same slot; a vendor that
    // spelled the index out ("发电机一") cannot serve as a template
    const templates = group
      .map((g) => ({ src: g, parts: g.zh.split(/\d+/) }))
      .filter((c) => c.parts.length === width + 1);
    if (!templates.length) continue;
    for (const { src, parts } of templates) {
      for (const g of group) {
        let out = parts[0];
        g.digits.forEach((d, i) => {
          out += d + parts[i + 1];
        });
        if (out !== src.zh && !derived.has(g.en)) derived.set(g.en, out);
      }
    }
  }
  return derived;
}

/** Post-compile quality gate. Returns problems grouped by kind. */
export function audit(dict, source, allow = DEFAULT_ALLOW, opts = {}) {
  const authored = opts.authored ?? new Set();
  const problems = { latinLeftover: [], unbalanced: [], selfExpanding: [], empty: [], sameAsEnglish: [], tooLong: [] };
  for (const [key, zh] of Object.entries(dict)) {
    const en = norm(source[key]);
    if (!zh) {
      problems.empty.push({ key, en });
      continue;
    }
    // A Latin-only target is a leak UNLESS a human typed it on purpose
    // ("CMC1" -> "CMC 1" normalises a legend; it is not an untranslated string).
    if (!hasCjk(zh) && zh !== en && !authored.has(zh)) problems.latinLeftover.push({ key, en, zh });
    if (!balanced(zh)) problems.unbalanced.push({ key, en, zh });
    if (zh.length > 46 && !/%[(!]/.test(zh)) problems.tooLong.push({ key, en, zh });
    // A Latin token is fine when it carries its own bracketed gloss ("MKR（指点标）") —
    // that is the house style for obscure abbreviations, not an untranslated word.
    const latinWords = [];
    for (const m of zh.matchAll(/([A-Za-z]{2,})(\s*（)?/g)) {
      const w = m[1];
      if (m[2]) continue; // annotated -> intentional
      const allowLc = new Set([...allow].map((x) => String(x).toUpperCase()));
      if (allowLc.has(w.toUpperCase())) continue;
      latinWords.push(w);
    }
    if (latinWords.length && zh !== en) problems.latinLeftover.push({ key, en, zh, words: [...new Set(latinWords)] });
    for (const abbr of zh.match(/\b[A-Z]{2,}\b/g) ?? []) {
      if (zh.includes(`${abbr}（`) && zh.split(`${abbr}（`).length > 2) problems.selfExpanding.push({ key, en, zh, abbr });
    }
    if (zh === en) problems.sameAsEnglish.push({ key, en });
  }
  return problems;
}

export function writeLocPak(file, language, dict) {
  fs.writeFileSync(file, JSON.stringify({ LocalisationPackage: { Language: language, Strings: dict } }, null, 2));
}
