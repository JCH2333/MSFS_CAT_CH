// One-off probe: run a project's wired engine in the audit DOM and print the
// exception the engine's own try/catch normally swallows.
// Usage: node probe-run.mjs a340
import fs from "fs";
import path from "path";
import vm from "vm";

const B = "F:/我的世界动画/AI项目/GSX汉化/微软模拟飞行插件汉化项目";
const CFG = {
  a340: { dict: B + "/INIA340EFB汉化工具/src/a340-zh-dict.js", v: "INIA340_DICT", core: B + "/INIA340EFB汉化工具/src/ini-zh-core.js", tag: "ini-efb-a340" },
  a380: { dict: B + "/INIA380EFB汉化工具/src/a380-zh-dict.js", v: "INIA380_DICT", core: B + "/INIA380EFB汉化工具/src/ini-zh-core.js", tag: "ini-efb-a380-ext" },
  pmdg: { dict: B + "/PMDGEFB汉化工具/src/pmdg-zh-dict.js", v: "PMDG_DICT", core: B + "/PMDGEFB汉化工具/src/pmdg-zh-core.js", tag: "pmdg-tablet" },
  a220: { dict: B + "/SYNA220EFB汉化工具/src/a220-zh-dict.js", v: "SYNA220_DICT", core: B + "/SYNA220EFB汉化工具/src/a220-zh-core.js", tag: "efb-a220" },
};
const id = process.argv[2] || "a340";
const c = CFG[id];
const dictSrc = fs.readFileSync(c.dict, "utf8");
const coreSrc = fs.readFileSync(c.core, "utf8").replace(/__ZH_DICT__/g, c.v).replace(/__ZH_TAG__/g, c.tag);
const wired = "(function () {\n" + dictSrc + "\n" + coreSrc + "\n})();";
console.log("[" + id + "] wired bytes:", wired.length);

class T { constructor(v) { this.nodeType = 3; this.nodeValue = v; this.parentElement = null; } }
class E {
  constructor(t) { this.nodeType = 1; this.tagName = String(t).toUpperCase(); this.childNodes = []; this.attributes = new Map(); this.style = { cssText: "" }; this.parentElement = null; this.id = ""; }
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
const html = new E("html"); const body = new E("body"); html.appendChild(body);
const host = new E("div"); host.id = "InstrumentContent"; body.appendChild(host);
for (const s of ["My Flight 中未设置到达机场。", "GPS（全球定位系统）", "SimBrief 用户 ID", "A220"]) {
  const d = new E("div"); const t = new T(s); t.parentElement = d; d.childNodes.push(t); host.appendChild(d);
}
function tw(root) {
  const nodes = []; const collect = n => { for (const c of n.childNodes) { nodes.push(c); if (c.nodeType === 1) collect(c); } };
  collect(root); let i = -1;
  return { get currentNode() { return root; }, nextNode() { i += 1; return i < nodes.length ? nodes[i] : null; } };
}
const sb = {
  console: { log() {}, warn: (...a) => console.log("  [engine warn]", a.map(x => String(x)).slice(0, 3).join(" | ")), error() {} },
  setTimeout: fn => { q.push(fn); return 1; }, clearTimeout() {}, setInterval: () => 1,
};
const q = [];
sb.MutationObserver = function (cb) { this.observe = () => { console.log("  [engine] observer registered"); }; sb.__fire = () => cb([]); };
sb.document = {
  readyState: "complete", documentElement: html, body, lang: "",
  createElement: t => new E(t), createTextNode: v => new T(v),
  getElementById: id => { for (const n of [html, ...html.getElementsByTagName("*")]) if (n.id === id) return n; return null; },
  addEventListener() {}, querySelector: s => sb.document.querySelectorAll(s)[0] || null,
  querySelectorAll: s => { const a = [html, ...html.getElementsByTagName("*")]; return s.startsWith("#") ? a.filter(e => e.id === s.slice(1)) : a.filter(e => e.tagName === s.toUpperCase()); },
  createTreeWalker: tw,
};
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
try { vm.runInContext(wired, sb, { filename: "wired-" + id + ".js" }); }
catch (e) { console.log("  [THROWN OUT OF SCRIPT] " + e.message); }
for (let r = 0; r < 4; r++) { for (const fn of q.splice(0)) { try { fn(); } catch (e) { console.log("  [THROWN IN SWEEP] " + e.message); } } if (sb.__fire) sb.__fire(); }
console.log("  lang=" + JSON.stringify(html.lang));
console.log("  nodes:");
for (const t of host.getElementsByTagName("*")) if (t.childNodes.some(c => c.nodeType === 3)) console.log("    " + JSON.stringify(t.textContent));
