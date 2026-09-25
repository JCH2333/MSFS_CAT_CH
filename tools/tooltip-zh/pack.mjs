/**
 * Package writers for Community override packages that ship a .locPak.
 *
 * Two facts, both verified against installed packages, drive this file:
 *  1. A .locPak is only loaded when it is ALSO listed in layout.json
 *     (flybywire-aircraft-a320-neo lists all 16 language files; fnx-aircraft-320 lists en-US.locPak).
 *  2. layout.json entries carry an 18-digit Windows FILETIME in `date`. JSON.parse turns that into a
 *     double and silently loses the low digits, so this module NEVER re-serialises an existing
 *     layout.json — it splices text in and then validates sizes on disk.
 */
import fs from 'node:fs';
import path from 'node:path';

const EPOCH_DIFF_100NS = 116444736000000000n; // between 1601-01-01 and 1970-01-01

/** 18-digit FILETIME string for a JS Date / ms timestamp. BigInt keeps every digit exact. */
export function filetime18(ms = Date.now()) {
  return ((BigInt(Math.floor(ms)) * 10000n) + EPOCH_DIFF_100NS).toString();
}

export function buildLocPakJson(language, strings, indent = 2) {
  return JSON.stringify({ LocalisationPackage: { Language: language, Strings: strings } }, null, indent);
}

/** Read layout.json `content` entries as text (no JSON.parse, so FILETIME digits survive). */
export function layoutEntries(text) {
  const out = [];
  for (const m of text.matchAll(/\{\s*"path"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"size"\s*:\s*(\d+)\s*,\s*"date"\s*:\s*(\d+)\s*\}/g)) {
    out.push({ path: JSON.parse(`"${m[1]}"`), size: +m[2], date: m[3], raw: m[0] });
  }
  return out;
}

/**
 * Splice new entries (or refresh sizes of existing ones) into layout.json text.
 * `files` = [{ path, size, date }] with forward-slash paths.
 */
export function layoutUpsert(text, files, indent = '        ') {
  let next = text;
  const blocks = files
    .map((f) => `${indent}{\n${indent}    "path": ${JSON.stringify(f.path)},\n${indent}    "size": ${f.size},\n${indent}    "date": ${f.date}\n${indent}}`)
    .join(',\n');
  const existing = layoutEntries(next);
  for (const f of files) {
    const hit = existing.find((e) => e.path === f.path);
    if (hit) {
      const patched = `{
${indent}    "path": ${JSON.stringify(f.path)},
${indent}    "size": ${f.size},
${indent}    "date": ${f.date}
${indent}    }`;
      next = next.replace(hit.raw, patched.replace(/^\{\n/, '{\n'));
      continue;
    }
    if (!/("content"\s*:\s*\[)/.test(next)) throw new Error('layout.json has no "content": [ anchor');
    next = next.replace(/("content"\s*:\s*\[)/, `$1\n${blocks},`);
    break; // blocks inserted once
  }
  return next;
}

/**
 * Every real file in the package must be listed with the right size, and every listed
 * path must exist. A layout.json that lies about the tree makes the whole package load
 * wrong in ways that look like unrelated corruption (odd lighting/effects), so this is
 * a hard gate, not a warning.
 */
export function validateLayout(pkgDir, { ignore = [] } = {}) {
  const text = fs.readFileSync(path.join(pkgDir, 'layout.json'), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`layout.json is not valid JSON: ${e.message}`] };
  }
  const errors = [];
  const listed = layoutEntries(text);
  if (listed.length !== parsed.content.length)
    errors.push(`regex saw ${listed.length} entries but JSON.parse saw ${parsed.content.length} — layout structure drifted`);
  // MSFS package paths are case-insensitive: the installed ini patches list
  // html_ui/pages/vcockpit/... while the files on disk are .../Pages/VCockpit/...
  const key = (p) => p.replace(/\\/g, '/').toLowerCase();
  const onDisk = [];
  const walk = (d, rel = '') => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else onDisk.push(r);
    }
  };
  walk(pkgDir);
  const listedByPath = new Map(listed.map((e) => [key(e.path), e]));
  for (const f of onDisk) {
    if (/^layout\.json$|^manifest\.json$/i.test(f) || ignore.some((g) => f.startsWith(g))) continue;
    const hit = listedByPath.get(key(f));
    if (!hit) {
      errors.push(`on disk but not listed: ${f}`);
      continue;
    }
    const size = fs.statSync(path.join(pkgDir, f.replace(/\//g, path.sep))).size;
    if (size !== hit.size) errors.push(`size mismatch ${f}: layout=${hit.size} disk=${size}`);
  }
  for (const e of listed) {
    const abs = path.join(pkgDir, e.path.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      errors.push(`listed but missing on disk: ${e.path}`);
      continue;
    }
    if (!/^\d{18}$/.test(e.date)) errors.push(`date is not an 18-digit FILETIME for ${e.path}: ${e.date}`);
  }
  return { ok: errors.length === 0, errors, entries: listed.length, files: onDisk.length };
}

/**
 * Correct declared sizes to match the bytes actually on disk.
 *
 * Found on the installed ini A380 package: its layout.json still carried the ORIGINAL
 * vendor file sizes while the shadow files it ships are bigger, so the package
 * mis-described itself. Rewritten per-entry as text; dates and everything else survive.
 */
export function layoutFixSizes(text, pkgDir) {
  const changes = [];
  const next = text.replace(
    /\{\s*"path"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"size"\s*:\s*(\d+)\s*,\s*"date"\s*:\s*(\d{18})\s*\}/g,
    (whole, rawPath, size, date) => {
      const p = JSON.parse(`"${rawPath}"`);
      const abs = path.join(pkgDir, p.replace(/\//g, path.sep));
      if (!fs.existsSync(abs)) return whole;
      const real = fs.statSync(abs).size;
      if (real === +size) return whole;
      changes.push({ path: p, declared: +size, actual: real });
      const ind = (/\n(\s*)\{/.exec(whole) ?? [, '        '])[1];
      return `{\n${ind}    "path": ${JSON.stringify(p)},\n${ind}    "size": ${real},\n${ind}    "date": ${date}\n${ind}}`;
    }
  );
  return { text: next, changes };
}

/** Write a complete minimal Community package (manifest + layout + payload files). */
export function writeCommunityPackage(pkgDir, { manifest, files, orderHint = 'PANEL_PATCH', contentType = 'UNKNOWN', indent = '        ' }) {
  fs.mkdirSync(pkgDir, { recursive: true });
  const now = Date.now();
  const entries = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(pkgDir, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    entries.push({ path: rel, size: fs.statSync(abs).size, date: filetime18(fs.statSync(abs).mtimeMs || now) });
  }
  const layout = {
    content: entries.map((e) => ({ path: e.path, size: e.size, date: BigInt(e.date) })),
  };
  // serialise BigInt back to bare digits
  const text = JSON.stringify(layout, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 4).replace(/"(\d{18})"/g, '$1');
  fs.writeFileSync(path.join(pkgDir, 'layout.json'), text);
  // Matches the convention already proven to load in this install (our own patch manifests):
  // a plain decimal string, not zero-padded.
  const totalSize = String(entries.reduce((a, e) => a + e.size, 0));
  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    JSON.stringify(
      {
        dependencies: [],
        content_type: contentType,
        title: manifest.title,
        manufacturer: manifest.manufacturer ?? 'MSFS_CAT_CH',
        creator: 'MSFS_CAT_CH',
        package_version: manifest.version,
        minimum_game_version: manifest.minimum_game_version ?? '1.7.27',
        minimum_compatibility_version: manifest.minimum_compatibility_version ?? '7.26.0.214',
        export_type: 'Community',
        builder: 'Microsoft Flight Simulator 2024',
        package_order_hint: orderHint,
        release_notes: { neutral: { LastUpdate: `Built ${new Date(now).toISOString().slice(0, 19).replace('T', ' ')}`, OlderHistory: '' } },
        total_package_size: totalSize,
      },
      null,
      4
    )
  );
  return { entries, totalSize };
}
