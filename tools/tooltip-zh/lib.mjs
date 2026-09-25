/**
 * locPak primitives shared by the cockpit-tooltip (悬浮提示) localization tool chain.
 *
 * A .locPak is NOT a tooltip file: it is MSFS's general localisation container
 * (tooltips, checklists, aircraft descriptions, ATC menus, loading tips, POI names...).
 * Shape on disk:
 *   { LocalisationPackage: { Language: "xx-XX", Strings: { "NS.KEY": "text" } } }
 *
 * Vendors use both `.locPak` and `.locpak` capitalisations, so every lookup here is
 * case-insensitive on the extension.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Keys whose text is rendered in the 3D-cockpit hover tooltip bubble. */
const TOOLTIP_KEY_RE = /(^|\.)(TOOLTIPS?V?\d?)\./i;

export function isTooltipKey(key) {
  return TOOLTIP_KEY_RE.test(key);
}

export function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text ?? ''));
}

export function listLocPakFiles(packageDir, recursive = false) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (recursive && depth < 4) walk(full, depth + 1);
        continue;
      }
      if (/\.locpak$/i.test(ent.name)) {
        const m = /^(.+)\.locpak$/i.exec(ent.name);
        out.push({ file: full, language: m[1], name: ent.name });
      }
    }
  };
  walk(packageDir, 0);
  return out.sort((a, b) => a.language.localeCompare(b.language));
}

export function parseLanguage(fileName) {
  const m = /^(.+)\.locpak$/i.exec(fileName);
  return m ? m[1] : null;
}

export function readLocPak(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { file, error: `JSON parse failed: ${err.message}`, language: parseLanguage(path.basename(file)), strings: {} };
  }
  const pkg = data?.LocalisationPackage;
  if (!pkg || typeof pkg !== 'object') {
    return { file, error: 'no LocalisationPackage envelope', language: parseLanguage(path.basename(file)), strings: {} };
  }
  return {
    file,
    language: pkg.Language ?? parseLanguage(path.basename(file)),
    declaredName: pkg.Language,
    strings: pkg.Strings && typeof pkg.Strings === 'object' ? pkg.Strings : {},
    envelopeKeys: Object.keys(pkg),
  };
}

/** Namespace histogram over a key set. */
export function namespaceHistogram(keys, depth = 2) {
  const map = new Map();
  for (const k of keys) {
    const ns = k.split('.').slice(0, depth).join('.');
    map.set(ns, (map.get(ns) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Status of every key of `baseKeys` inside a target-language package.
 * Categories are mutually exclusive and exhaustive over baseKeys.
 *  missing    - key absent from the target file
 *  empty      - present but ""
 *  identical  - present, equal to the English source (vendor stub, untranslated)
 *  translated - present, differs from English
 *  latin      - present, differs from English, but contains no CJK (transliteration/other language)
 */
export function auditLanguage(enStrings, targetStrings) {
  const buckets = { missing: [], empty: [], identical: [], latin: [], translated: [] };
  for (const [key, en] of Object.entries(enStrings)) {
    if (!(key in targetStrings)) {
      buckets.missing.push(key);
      continue;
    }
    const zh = targetStrings[key];
    if (zh === '') buckets.empty.push(key);
    else if (zh === en) buckets.identical.push(key);
    else if (!hasCjk(zh)) buckets.latin.push(key);
    else buckets.translated.push(key);
  }
  const extra = Object.keys(targetStrings).filter((k) => !(k in enStrings));
  return { buckets, extra };
}

/** Suffix histogram over tooltip keys — reveals the per-state variants. */
export function suffixHistogram(keys) {
  const map = new Map();
  for (const k of keys) {
    const parts = k.split('.');
    const suf = parts.length > 2 ? parts[parts.length - 1] : '(bare)';
    map.set(suf, (map.get(suf) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Control-name part of a tooltip key: everything between namespace and suffix. */
export function controlOf(key) {
  const parts = key.split('.');
  if (parts.length <= 2) return key;
  return parts.slice(1, -1).join('.');
}

export function walkFiles(dir, filter, out = [], depth = 0) {
  if (depth > 9) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, filter, out, depth + 1);
    else if (filter(ent.name, full)) out.push(full);
  }
  return out;
}
