// Scan every dictionary for the worst class of FRAGMENTS rule: one whose
// replacement contains its own source term. Such a rule appends text on every
// sweep (every 1.2–2 s), so the label grows without bound instead of merely
// half-translating once.
// Usage: node self-expanding.js
import fs from "fs";
import vm from "vm";

const B = "F:/我的世界动画/AI项目/GSX汉化/微软模拟飞行插件汉化项目/";
const PROJECTS = [
  ["A340", "INIA340EFB汉化工具/src/a340-zh-dict.js", "INIA340_DICT"],
  ["A380", "INIA380EFB汉化工具/src/a380-zh-dict.js", "INIA380_DICT"],
  ["PMDG", "PMDGEFB汉化工具/src/pmdg-zh-dict.js", "PMDG_DICT"],
  ["FENIX", "FENIX320EFB汉化工具/src/fenix-zh-dict.js", "FENIX320_DICT"],
  ["MD11", "TFDIMD11EFB汉化工具/src/md11-zh-dict.js", "MD11_DICT"],
  ["A220", "SYNA220EFB汉化工具/src/a220-zh-dict.js", "SYNA220_DICT"],
];

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

console.log("proj   FRAGS  自我扩展规则  哪些 EXACT 译文会因此被再命中");
for (const [name, file, variable] of PROJECTS) {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(B + file, "utf8") + "\nthis.d = " + variable + ";", sb, { filename: "d.js" });
  const d = sb.d;
  const fragments = d.FRAGMENTS || [];
  const bad = fragments.filter(([from, to]) =>
    from && new RegExp("\\b" + esc(from) + "\\b", "i").test(String(to)));
  const values = [...new Set(Object.values(d.EXACT || {}).filter(v => typeof v === "string"))];
  const exposed = [];
  for (const v of values) {
    for (const [from] of bad) {
      if (new RegExp("\\b" + esc(from) + "\\b", "i").test(v)) { exposed.push(v + "  ⟵ 规则 [" + from + "→" + d.FRAGMENTS.find(f => f[0] === from)[1] + "]"); break; }
    }
  }
  console.log(name.padEnd(6) + String(fragments.length).padStart(6) + String(bad.length).padStart(14) + String(exposed.length).padStart(28));
  for (const b of bad) console.log("        规则 " + JSON.stringify(b));
  for (const e of exposed.slice(0, 6)) console.log("        暴露 " + e);
}
