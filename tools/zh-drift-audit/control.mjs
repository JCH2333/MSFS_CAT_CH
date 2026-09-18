// Positive control for the drift audit.
//
// audit.mjs reported "0 drift" for every aircraft — including A220, where the
// bug was observed by hand. Before trusting a negative result we must prove the
// harness can detect the bug at all: strip the CJK idempotency guard from each
// engine (recreating the pre-fix behaviour) and re-run.
//
//   guard still absent + drift appears   -> harness works, other aircraft are
//                                           only *latently* exposed (data decides)
//   guard still absent + no drift        -> those dictionaries genuinely never
//                                           re-match, no fix needed
//
// Usage: node control.mjs
import fs from "fs";
import path from "path";
import vm from "vm";

const B = "F:/我的世界动画/AI项目/GSX汉化/微软模拟飞行插件汉化项目";

const PROJECTS = [
  { id: "a340", label: "iniBuilds A340", dict: B + "/INIA340EFB汉化工具/src/a340-zh-dict.js", v: "INIA340_DICT", core: B + "/INIA340EFB汉化工具/src/ini-zh-core.js", tag: "ini-efb-a340" },
  { id: "a380", label: "iniBuilds A380", dict: B + "/INIA380EFB汉化工具/src/a380-zh-dict.js", v: "INIA380_DICT", core: B + "/INIA380EFB汉化工具/src/ini-zh-core.js", tag: "ini-efb-a380-ext" },
  { id: "a350", label: "iniBuilds A350", self: B + "/INI350EFB汉化工具/src/ini-efb-a350.zh-patch.js" },
  { id: "pmdg", label: "PMDG Tablet", dict: B + "/PMDGEFB汉化工具/src/pmdg-zh-dict.js", v: "PMDG_DICT", core: B + "/PMDGEFB汉化工具/src/pmdg-zh-core.js", tag: "pmdg-tablet" },
  { id: "fenix", label: "Fenix A320", dict: B + "/FENIX320EFB汉化工具/src/fenix-zh-dict.js", v: "FENIX320_DICT", core: B + "/FENIX320EFB汉化工具/src/fenix-zh-engine.js" },
  { id: "md11", label: "TFDi MD-11", dict: B + "/TFDIMD11EFB汉化工具/src/md11-zh-dict.js", v: "MD11_DICT", core: B + "/TFDIMD11EFB汉化工具/src/md11-zh-core.js", tag: "md11-efb" },
  { id: "a220", label: "Synaptic A220", dict: B + "/SYNA220EFB汉化工具/src/a220-zh-dict.js", v: "SYNA220_DICT", core: B + "/SYNA220EFB汉化工具/src/a220-zh-core.js", tag: "efb-a220" },
];

// The guard block, as written in a220/md11 cores.
const GUARD_RE = /\n *\/\*[^*]*幂等保护[\s\S]*?\n {6}if \(\/\[\\u4E00-\\u9FFF\]\/\.test\(String\(value\)\)\) \{\n *return value;\n *\}\n/;

function loadDict(p) {
  const sb = {};
  vm.createContext(sb);
  if (p.self) {
    const src = fs.readFileSync(p.self, "utf8");
    const lit = name => {
      const head = "var " + name + " = ";
      const at = src.indexOf(head);
      if (at < 0) return null;
      const open = src[at + head.length];
      const close = open === "{" ? "}" : "]";
      let i = src.indexOf(open, at), depth = 0, inStr = null;
      for (; i < src.length; i++) {
        const c = src[i];
        if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
        if (c === "'" || c === '"') { inStr = c; continue; }
        if (c === open) depth++;
        else if (c === close) { depth--; if (!depth) break; }
      }
      try { return vm.runInContext("(" + src.slice(at + head.length, i + 1) + ")", vm.createContext({})); } catch (_e) { return null; }
    };
    return { EXACT: lit("EXACT") || {}, BOOT_HTML: lit("BOOT_HTML") || {} };
  }
  vm.runInContext(fs.readFileSync(p.dict, "utf8") + "\nthis.__d = " + p.v + ";", sb, { filename: "d.js" });
  return sb.__d;
}

function wire(p, mode) {
  let src;
  if (p.self) src = fs.readFileSync(p.self, "utf8");
  else {
    const dict = fs.readFileSync(p.dict, "utf8");
    const core = fs.readFileSync(p.core, "utf8").replace(/__ZH_DICT__/g, p.v).replace(/__ZH_TAG__/g, p.tag || "x");
    src = p.dict && p.core ? "(function () {\n" + dict + "\n" + core + "\n})();" : core;
  }
  const had = GUARD_RE.test(src);
  if (mode === "unguard") src = src.replace(GUARD_RE, "\n");
  return { src, hadGuard: had };
}

class T { constructor(v) { this.nodeType = 3; this.nodeValue = v; this.parentElement = null; } get parentNode() { return this.parentElement; } }
class E {
  constructor(t) { this.nodeType = 1; this.tagName = String(t).toUpperCase(); this.childNodes = []; this.attributes = new Map(); this.style = { cssText: "" }; this.parentElement = null; this.id = ""; }
  get parentNode() { return this.parentElement; }
  closest(sel) { let n = this; while (n) { if (sel && sel.startsWith('#') && n.id === sel.slice(1)) return n; n = n.parentElement; } return null; }
  get childElementCount() { return this.childNodes.filter(x => x.nodeType === 1).length; }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(n) { n.parentElement = this; this.childNodes.push(n); return n; }
  removeChild(n) { this.childNodes = this.childNodes.filter(c => c !== n); return n; }
  set textContent(v) { this.childNodes = []; const t = new T(v); t.parentElement = this; this.childNodes.push(t); }
  get textContent() { return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(""); }
  set innerHTML(v) { this.textContent = String(v).replace(/<[^>]+>/g, ""); }
  get innerHTML() { return this.textContent; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); if (k === "id") this.id = v; }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  getElementsByTagName(s) { const o = []; const w = n => { for (const c of n.childNodes) if (c.nodeType === 1) { o.push(c); w(c); } }; w(this); return s === "*" ? o : o.filter(e => e.tagName === s.toUpperCase()); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  querySelectorAll(s) { const a = this.getElementsByTagName("*"); return s.startsWith("#") ? a.filter(e => e.id === s.slice(1)) : a.filter(e => e.tagName === s.toUpperCase()); }
}

function run(src, seedTexts) {
  const html = new E("html"); const body = new E("body"); html.appendChild(body);
  const host = new E("div"); host.id = "InstrumentContent"; body.appendChild(host);
  for (const s of seedTexts) { const d = new E("div"); const t = new T(s); t.parentElement = d; d.childNodes.push(t); host.appendChild(d); }
  var errs = [];

  const q = [];
  const sb = {
    console: { log() {}, warn(...a) { errs.push(a.map(String).join(' ').slice(0,160)); }, error() {} },
    setTimeout: fn => { q.push(fn); return 1; }, clearTimeout() {}, setInterval: () => 1,
  };
  sb.MutationObserver = function (cb) { this.observe = () => {}; sb.__fire = () => cb([]); };
  sb.document = {
    readyState: "complete", documentElement: html, body, lang: "",
    createElement: t => new E(t), createTextNode: v => new T(v),
    getElementById: id => [html, ...html.getElementsByTagName("*")].find(e => e.id === id) || null,
    addEventListener() {},
    querySelector: s => sb.document.querySelectorAll(s)[0] || null,
    querySelectorAll: s => { const a = [html, ...html.getElementsByTagName("*")]; return s.startsWith("#") ? a.filter(e => e.id === s.slice(1)) : a.filter(e => e.tagName === s.toUpperCase()); },
    createTreeWalker(root) {
      const nodes = []; const collect = n => { for (const c of n.childNodes) { nodes.push(c); if (c.nodeType === 1) collect(c); } };
      collect(root); let i = -1;
      return { get currentNode() { return root; }, nextNode() { i += 1; return i < nodes.length ? nodes[i] : null; } };
    },
  };
  sb.window = sb; sb.globalThis = sb; sb.navigator = { language: "zh-CN" };
  sb.location = { href: "http://localhost:8083/", origin: "http://localhost:8083" }; sb.parent = { postMessage(m) { if (m && typeof m.value === 'string' && /^engine_(error|doc|scan)/.test(m.key)) errs.push(m.key + ': ' + m.value.slice(0, 150)); } };
  vm.createContext(sb);
  try { vm.runInContext(src, sb, { filename: "e.js" }); } catch (e) { return { error: e.message }; }
  const sweep = () => { for (const fn of q.splice(0)) { try { fn(); } catch (_e) {} } if (sb.__fire) sb.__fire(); };
  const snaps = [];
  for (let r = 0; r < 6; r++) { sweep(); snaps.push(host.childNodes.map(d => d.textContent)); }
  return { snaps, alive: html.lang === "zh-CN" };
}

console.log("mode            project          seeds  alive  drift  example");
for (const mode of ["as-shipped", "unguard"]) {
  for (const p of PROJECTS) {
    const dict = loadDict(p);
    const values = [];
    for (const v of Object.values(dict.EXACT || {})) if (typeof v === "string") values.push(v);
    for (const v of Object.values(dict.BOOT_HTML || {})) if (typeof v === "string") values.push(v.replace(/<[^>]+>/g, " "));
    const seeds = [...new Set(values.filter(v => /[A-Za-z]{2}/.test(v) && /[\u4E00-\u9FFF]/.test(v)))];
    const { src, hadGuard } = wire(p, mode);
    const { snaps, alive, error } = run(src, seeds);
    if (error) { console.log(mode.padEnd(15) + p.label.padEnd(16) + "  !! " + error); continue; }
    const r1 = snaps[0] || [], last = snaps[snaps.length - 1] || [];
    const drift = [];
    for (let i = 0; i < seeds.length; i++) if (r1[i] !== seeds[i] || last[i] !== r1[i]) drift.push([seeds[i], r1[i], last[i]]);
    console.log(
      mode.padEnd(15) + p.label.padEnd(16) +
      String(seeds.length).padStart(5) + "  " + (alive ? "yes " : "NO  ") + " " +
      String(drift.length).padStart(5) + "   " +
      "guard=" + (hadGuard ? "有" : "无") +
      (drift[0] ? "   e.g. " + JSON.stringify(drift[0][0]) + " → " + JSON.stringify(drift[0][2]) : "")
    );
  }
}
