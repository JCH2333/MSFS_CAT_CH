/**
 * ModelBehaviour template interpreter — resolves the tooltip text/key that a hover
 * actually produces, which a flat grep cannot.
 *
 * Real idiom (learned from fnx-aircraft-320 ModelBehaviorDefs/fnx32x/Templates/Interactions.xml):
 *
 *   <Template Name="X">
 *     <Parameters Type="Default">          <- defaults, overridable by the caller
 *       <ANIMTIP_0>ON</ANIMTIP_0>
 *       <Condition Valid="HAS_COVER">      <- conditional parameter assignment
 *         <True><ANIMTIP_0_COVER>OPEN</ANIMTIP_0_COVER></True>
 *       </Condition>
 *     </Parameters>
 *     <UseTemplate Name="Sub"> ... </UseTemplate>   <- delegation, params inherit
 *     <TooltipID>TT:NS.#ANIM_NAME#.#ANIMTIP#</TooltipID>
 *   </Template>
 *
 * Only `<Parameters>`/`<Condition>` blocks assign params; everything else is payload.
 */

export const TOOLTIP_TAGS = [
  'TooltipID',
  'AnimTip',
  'AnimTip_0',
  'AnimTip_1',
  'AnimTip_2',
  'AnimTip_3',
  'TOOLTIP_ID',
  'IE_TOOLTIP_TITLE_ID',
  'IE_TOOLTIP_DESCRIPTION_ID',
  'IE_TOOLTIP_VALUE_ID',
  'TT_ID',
  'TT_PACKAGE',
];

const elemRe = (tag) => new RegExp(`<${tag}(?:\\s[^>/]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
const DIRECT_CHILD = /<([A-Za-z][\w]*)\s*(?:\/>|>\s*([^<]*?)\s*<\/\1>)/g;

function isTruthy(v) {
  return v != null && v !== '' && !/^(false|0|no)$/i.test(String(v).trim());
}

/** Direct children of an XML fragment as {name: value} — parameters and simple blocks only. */
export function childParams(fragment) {
  const out = {};
  if (!fragment) return out;
  // strip nested blocks so we only read this level
  const flat = fragment.replace(/<Condition[\s\S]*?<\/Condition>/gi, '');
  for (const m of flat.matchAll(DIRECT_CHILD)) {
    if (/^(Parameters|Component|UseTemplate|Condition)$/i.test(m[1])) continue;
    const name = m[1];
    const value = (m[2] ?? '').trim();
    if (!(name in out)) out[name] = value;
  }
  return out;
}

function conditions(fragment) {
  const list = [];
  for (const m of fragment.matchAll(/<Condition\s+([^>]*)>([\s\S]*?)<\/Condition>/gi)) {
    const attrs = {};
    for (const a of m[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[a[1].toLowerCase()] = a[2];
    const body = m[2];
    const branch = (which) => {
      const re = new RegExp(`<${which}(?:\\s[^>]*)?>([\\s\\S]*?)</${which}\\s*>`, 'gi');
      let merged = {};
      for (const b of body.matchAll(re)) merged = { ...merged, ...childParams(b[1]) };
      return merged;
    };
    list.push({ attrs, true: branch('True'), false: branch('False') });
  }
  return list;
}

export function parseTemplates(xmlSources) {
  const templates = new Map();
  for (const [file, text] of xmlSources) {
    for (const m of text.matchAll(/<Template\s+Name="([^"]+)"([\s\S]*?)<\/Template>/gi)) {
      const body = m[2];
      let defaults = {};
      const conds = [];
      for (const p of body.matchAll(/<Parameters[^>]*>([\s\S]*?)<\/Parameters>/gi)) {
        defaults = { ...defaults, ...childParams(p[1]) };
        conds.push(...conditions(p[1]));
      }
      const entry = { name: m[1], body, defaults, conds, file };
      // a template name may be <Include>d from several files; first definition wins, later ones recorded
      if (!templates.has(entry.name)) templates.set(entry.name, entry);
      else entry.shadowed = true;
    }
  }
  return templates;
}

/** Params a <UseTemplate> block passes down. */
export function useParams(block) {
  return childParams(block);
}

export function resolveParams(tpl, incoming, trace = []) {
  const p = { ...incoming };
  for (const [k, v] of Object.entries(tpl.defaults)) {
    if (v !== '' && (p[k] == null || p[k] === '')) p[k] = v;
    else if (!(k in p)) p[k] = v;
  }
  for (const c of tpl.conds) {
    const a = c.attrs;
    let pass;
    if (a.valid) pass = isTruthy(p[a.valid]);
    else if (a.notempty) pass = isTruthy(p[a.notempty]);
    else pass = null;
    if (pass === null) {
      trace.push(`un-evaluable Condition ${JSON.stringify(a)} in ${tpl.name}`);
      continue;
    }
    Object.assign(p, pass ? c.true : c.false);
  }
  return p;
}

export function expand(text, params, missing) {
  return text.replace(/#([A-Za-z0-9_]+)#/g, (whole, name) => {
    const v = params[name];
    if (v == null || v === '') {
      missing?.add?.(name);
      return whole;
    }
    return v;
  });
}

/**
 * Walk a UseTemplate instantiation and yield every tooltip-bearing value with its
 * parameters already resolved (recursing through delegation).
 */
export function* resolveTooltipValues(templates, useName, useBlock, opts = {}) {
  const depth = opts.depth ?? 0;
  const pathTaken = opts.path ?? [];
  if (depth > 6 || pathTaken.includes(useName)) {
    yield { kind: 'guard', file: null, tag: null, value: `recursion limit at ${useName}`, unresolved: [] };
    return;
  }
  const tpl = templates.get(useName);
  if (!tpl) {
    yield { kind: 'external', file: null, tag: null, value: `template ${useName} not in package`, unresolved: [] };
    return;
  }
  const incoming = { ...(opts.inherit ?? {}), ...useParams(useBlock) };
  const params = resolveParams(tpl, incoming, opts.trace ??= []);
  const missing = new Set();
  const body = expand(tpl.body, params, missing);

  for (const tag of TOOLTIP_TAGS) {
    for (const m of body.matchAll(elemRe(tag))) {
      if (m[1].includes('<')) continue; // nested markup: not a plain string
      yield {
        file: tpl.file,
        tag,
        value: m[1].replace(/\s+/g, ' ').trim(),
        params,
        missing: [...missing],
        via: [...pathTaken, useName].join(' > '),
      };
    }
  }
  for (const inner of body.matchAll(/<UseTemplate\s+Name="([^"]+)"([\s\S]*?)<\/UseTemplate>/gi)) {
    // delegation inherits the resolved parameter set; the inner block overrides it
    yield* resolveTooltipValues(templates, inner[1], inner[2], {
      depth: depth + 1,
      pathTaken: [...pathTaken, useName],
      trace: opts.trace,
      inherit: params,
    });
  }
}

/** Find every <UseTemplate> top-level instantiation in a behaviour file. */
export function* findUses(text) {
  for (const m of text.matchAll(/<UseTemplate\s+Name="([^"]+)"([\s\S]*?)<\/UseTemplate>/gi)) {
    yield { name: m[1], block: m[2] };
  }
}
