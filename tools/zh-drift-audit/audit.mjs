// Cross-aircraft re-translation ("drift") audit.
//
// Every patch engine sweeps the DOM repeatedly (MutationObserver + setInterval).
// A text node that already contains Chinese still passes shouldTranslateText as
// long as it keeps some Latin letters ("My Flight 中未设置…"), so the FRAGMENTS
// pass can rewrite it a second time on the next sweep — turning a correct
// translation into a half-translated one, and never settling.
//
// This harness runs each aircraft's REAL engine (same wiring the build script
// uses) inside a minimal DOM shim, seeds the DOM with that aircraft's own
// dictionary outputs, sweeps repeatedly, and reports what changed and whether
// it converged.
//
// Usage: node audit.mjs [--project a340] [--rounds 8]
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const REPO = "F:/我的世界动画/AI项目/GSX汉化";
const B = path.join(REPO, "微软模拟飞行插件汉化项目");
const args = process.argv.slice(2);
const only = args.includes("--project") ? args[args.indexOf("--project") + 1] : null;
const ROUNDS = args.includes("--rounds") ? Number(args[args.indexOf("--rounds") + 1]) : 8;

const PROJECTS = [
  { id: "a340", name: "iniBuilds A340 (EFB+FAP)", dict: [B, "INIA340EFB汉化工具/src/a340-zh-dict.js"], dictVar: "INIA340_DICT", core: [B, "INIA340EFB汉化工具/src/ini-zh-core.js"], tag: "ini-efb-a340" },
  { id: "a380", name: "iniBuilds A380 (EFB+OIS+FAP)", dict: [B, "INIA380EFB汉化工具/src/a380-zh-dict.js"], dictVar: "INIA380_DICT", core: [B, "INIA380EFB汉化工具/src/ini-zh-core.js"], tag: "ini-efb-a380-ext" },
  { id: "a350", name: "iniBuilds A350 EFB", dict: null, selfContained: [B, "INI350EFB汉化工具/src/ini-efb-a350.zh-patch.js"] },
  { id: "pmdg", name: "PMDG Tablet (8 机型)", dict: [B, "PMDGEFB汉化工具/src/pmdg-zh-dict.js"], dictVar: "PMDG_DICT", core: [B, "PMDGEFB汉化工具/src/pmdg-zh-core.js"], tag: "pmdg-tablet" },
  { id: "fenix", name: "Fenix A320 EFB", dict: [B, "FENIX320EFB汉化工具/src/fenix-zh-dict.js"], dictVar: "FENIX320_DICT", core: [B, "FENIX320EFB汉化工具/src/fenix-zh-engine.js"], fenixWire: true },
  { id: "md11", name: "TFDi MD-11 EFB", dict: [B, "TFDIMD11EFB汉化工具/src/md11-zh-dict.js"], dictVar: "MD11_DICT", core: [B, "TFDIMD11EFB汉化工具/src/md11-zh-core.js"], tag: "md11-efb" },
  { id: "a220", name: "Synaptic A220 EFB（参照：已加幂等保护）", dict: [B, "SYNA220EFB汉化工具/src/a220-zh-dict.js"], dictVar: "SYNA220_DICT", core: [B, "SYNA220EFB汉化工具/src/a220-zh-core.js"], tag: "efb-a220" },
];

const read = p => fs.readFileSync(p.join ? path.join(...p) : p, "utf8");

// Extract the dictionary contents of a standalone `var X_DICT = {...};` file.
function loadDict(p, variable) {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(read(p) + "\nthis.__d = " + variable + ";", sb, { filename: "dict.js" });
  return sb.__d;
}

// The A350 patch keeps its dictionaries inline; pull the literals out textually.
function loadInlineDicts(file) {
  const src = read(file);
  function literal(name) {
    const at = src.indexOf("var " + name + " = {") >= 0 ? src.indexOf("var " + name + " = {") : src.indexOf("var " + name + " = [");
    if (at < 0) return null;
    const open = src[at + ("var " + name + " = ").length];
    const close = open === "{" ? "}" : "]";
    let i = src.indexOf(open, at), depth = 0, inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
      if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (!depth) break; }
    }
    const text = src.slice(at + ("var " + name + " = ").length, i + 1);
    try { return vm.runInContext("(" + text + ")", vm.createContext({})); } catch (e) { console.log("  ! literal parse failed for " + name + ": " + e.message); return null; }
  }
  return { EXACT: literal("EXACT") || {}, FRAGMENTS: literal("FRAGMENTS") || [], BOOT_HTML: literal("BOOT_HTML") || {}, PRESERVE: literal("PRESERVE") || {} };
}

// ---- minimal DOM (same semantics as the A220 engine test) -----------------
function makeDom(seeds) {
  class TextNode { constructor(v) { this.nodeType = 3; this.nodeValue = v; this.parentElement = null; } get parentNode() { return this.parentElement; } }
  class El {
    constructor(tag) { this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.childNodes = []; this.attributes = new Map(); this.style = { cssText: "" }; this.parentElement = null; this.id = ""; }
    get parentNode() { return this.parentElement; }
  closest(sel) { let n = this; while (n) { if (sel && sel.startsWith('#') && n.id === sel.slice(1)) return n; n = n.parentElement; } return null; }
  get childElementCount() { return this.childNodes.filter(c => c.nodeType === 1).length; }
    get firstChild() { return this.childNodes[0] || null; }
    appendChild(n) { n.parentElement = this; this.childNodes.push(n); return n; }
    removeChild(n) { this.childNodes = this.childNodes.filter(c => c !== n); return n; }
    set textContent(v) { this.childNodes = []; const t = new TextNode(v); t.parentElement = this; this.childNodes.push(t); }
    get textContent() { return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(""); }
    set innerHTML(v) { this.textContent = String(v).replace(/<[^>]+>/g, ""); }
    get innerHTML() { return this.textContent; }
    setAttribute(k, v) { this.attributes.set(k, String(v)); if (k === "id") this.id = v; }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    getElementsByTagName(sel) { const out = []; const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { out.push(c); walk(c); } }; walk(this); return sel === "*" ? out : out.filter(e => e.tagName === sel.toUpperCase()); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    querySelectorAll(s) { const all = this.getElementsByTagName("*"); if (s.startsWith("#")) return all.filter(e => e.id === s.slice(1)); return all.filter(e => e.tagName === s.toUpperCase()); }
    *walk() { yield this; for (const c of this.childNodes) if (c.nodeType === 1) yield* c.walk(); }
  }
  const body = new El("body");
  const html = new El("html");
  html.appendChild(body);
  const host = new El("div");
  host.id = "InstrumentContent";
  body.appendChild(host);
  for (const t of seeds.text) {
    const d = new El("div");
    const n = new TextNode(t);
    n.parentElement = d;
    d.childNodes.push(n);
    host.appendChild(d);
  }
  for (const a of seeds.attr) {
    const i = new El("input");
    i.setAttribute(a.name, a.value);
    host.appendChild(i);
  }
  const shim = {
    readyState: "complete",
    documentElement: html,
    body,
    lang: "",
    createElement: t => new El(t),
    createTextNode: v => new TextNode(v),
    getElementById: id => { for (const n of html.walk()) if (n.nodeType === 1 && n.id === id) return n; return null; },
    addEventListener() {},
    querySelector: s => shim.querySelectorAll(s)[0] || null,
    querySelectorAll: s => { const all = []; for (const n of html.walk()) if (n.nodeType === 1) all.push(n); return s.startsWith("#") ? all.filter(e => e.id === s.slice(1)) : all.filter(e => e.tagName === s.toUpperCase()); },
    createTreeWalker(root) {
      const nodes = [];
      const collect = n => { for (const c of n.childNodes) { nodes.push(c); if (c.nodeType === 1) collect(c); } };
      collect(root);
      let i = -1;
      return { get currentNode() { return root; }, nextNode() { i += 1; return i < nodes.length ? nodes[i] : null; } };
    },
  };
  return { html, body, shim, TextNode, El };
}

function runEngine(srcText, seeds) {
  const { html, body, shim } = makeDom(seeds);
  let registered = false;
  const sb = {
    console: { log() {}, warn(...a) { sb.__warns.push(a.map(String).join(" ")); }, error() {} },
    setTimeout: fn => { sb.__q.push(fn); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    requestAnimationFrame(fn) { sb.__q.push(fn); return 1; },
    __q: [], __warns: [],
    __fire: null,
  };
  sb.MutationObserver = function (cb) { this.observe = () => { registered = true; }; sb.__fire = () => cb([]); };
  sb.document = shim;
  sb.window = sb;
  sb.globalThis = sb;
  sb.navigator = { language: "zh-CN", userAgent: "CoherentGT" };
  sb.location = { href: "http://localhost:8083/", origin: "http://localhost:8083" };
  sb.parent = { postMessage(m) { if (m && typeof m.value === 'string' && /^engine_(error|doc|scan)/.test(m.key)) errs.push(m.key + ': ' + m.value.slice(0, 150)); } };
  vm.createContext(sb);
  vm.runInContext(srcText, sb, { filename: "engine-audit.js" });
  const flush = () => { for (const fn of sb.__q.splice(0)) { try { fn(); } catch (e) { /* engine catches internally */ } } };
  const snapshots = [];
  for (let r = 0; r < ROUNDS; r++) {
    flush();
    if (sb.__fire) sb.__fire();
    const texts = [];
    const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) texts.push(c.nodeValue); else if (c.nodeType === 1) walk(c); } };
    walk(body);
    snapshots.push(texts);
  }
  return { snapshots, registered, lang: html.lang, warns: sb.__warns };
}


function analyse(dict, engineSrc, label) {
  const values = [];
  for (const v of Object.values(dict.EXACT || {})) if (typeof v === "string") values.push(v);
  for (const v of Object.values(dict.BOOT_HTML || {})) if (typeof v === "string") values.push(v.replace(/<[^>]+>/g, " "));

  const latin = values.filter(v => /[A-Za-z]{2}/.test(v) && /[\u4E00-\u9FFF]/.test(v));
  const seedTexts = [...new Set(latin)].slice(0, 900);
  const seeds = {
    text: seedTexts,
    attr: [{ name: "title", value: "Covers Attached" }, { name: "placeholder", value: "TRED Altitude" }],
  };
  const { snapshots, registered, lang, warns } = runEngine(engineSrc, seeds);
  console.log("\n### " + label);
  console.log("  [诊断] MutationObserver 注册=" + registered + "  documentElement.lang=" + JSON.stringify(lang) +
    "  节点数 seed=" + seedTexts.length + " r1=" + (snapshots[0] || []).length);

  // 关键判据：DOM 里放着「正确译文」时，下一轮巡检会不会把它改掉。
  const round1 = (snapshots[0] || []).slice(0, seedTexts.length);
  const last = (snapshots[snapshots.length - 1] || []).slice(0, seedTexts.length);

  const drift = [];
  for (let i = 0; i < seedTexts.length; i++) {
    const a = seedTexts[i], b = round1[i], z = last[i];
    if (b !== a || z !== b) drift.push({ seed: a, round1: b, final: z });
  }
  let lastChangeRound = 0;
  for (let r = 1; r < snapshots.length; r++) {
    if (JSON.stringify(snapshots[r]) !== JSON.stringify(snapshots[r - 1])) lastChangeRound = r;
  }
  const neverSettled = snapshots.length > 1 &&
    JSON.stringify(snapshots[snapshots.length - 1].slice(0, seedTexts.length)) !==
    JSON.stringify(snapshots[snapshots.length - 2].slice(0, seedTexts.length));

  console.log("\n### " + label);
  console.log("  词典译文「含中文且含拉丁字母」条数: " + seedTexts.length + " / 全部译文 " + new Set(values).size);
  console.log("  下一轮巡检即被改写的节点: " + drift.length);
  console.log("  最后一次变化发生在第 " + lastChangeRound + " 轮" + (neverSettled ? "  →  末轮仍在变（未收敛）" : "  →  已收敛"));
  for (const d of drift.slice(0, 12)) {
    console.log("    · " + JSON.stringify(d.seed) + "  →R1→  " + JSON.stringify(d.round1) + (d.final !== d.round1 ? "  →末→  " + JSON.stringify(d.final) : ""));
  }
  if (drift.length > 12) console.log("    … 其余 " + (drift.length - 12) + " 条");
  return { label, candidates: seedTexts.length, drift: drift.length, neverSettled, samples: drift.slice(0, 12) };
}


const results = [];
for (const p of PROJECTS) {
  if (only && p.id !== only) continue;
  try {
    if (p.selfContained) {
      const dict = loadInlineDicts(p.selfContained);
      results.push(analyse(dict, read(p.selfContained), p.name));
      continue;
    }
    const dict = loadDict(p.dict, p.dictVar);
    let engine;
    if (p.fenixWire) {
      engine = read(p.core).replace(/__ZH_DICT__/g, "(function () { " + read(p.dict) + "\nreturn " + p.dictVar + " }())");
    } else {
      const core = read(p.core).replace(/__ZH_DICT__/g, p.dictVar).replace(/__ZH_TAG__/g, p.tag);
      engine = "(function () {\n" + read(p.dict) + "\n" + core + "\n})();";
    }
    results.push(analyse(dict, engine, p.name));
  } catch (e) {
    console.log("\n### " + p.name + "\n  !! 审计失败: " + e.message);
  }
}

console.log("\n==================== 汇总 ====================");
for (const r of results) {
  const verdict = r.drift === 0 ? "无漂移" : (r.neverSettled ? "需修复：漂移且未收敛" : "需修复：漂移 " + r.drift + " 条（可收敛但显示错误）");
  console.log("  " + r.label.padEnd(34) + " 候选 " + String(r.candidates).padStart(4) + "  漂移 " + String(r.drift).padStart(4) + "   " + verdict);
}
