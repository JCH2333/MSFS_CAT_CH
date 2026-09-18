// Why does only A220 drift? The trigger is data-dependent: a FRAGMENTS rule
// whose source term is a single Latin word can re-match *inside* a translation
// that deliberately keeps that word (My Flight, SimBrief, GPS…). This counts the
// latent exposure in every dictionary so the fix decision is evidence-based.
// Usage: node latent-exposure.js
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

console.log("proj   FRAG总数  单词FRAG  译文被二次命中  触发词        样例");
for (const [name, file, variable] of PROJECTS) {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(B + file, "utf8") + "\nthis.d = " + variable + ";", sb, { filename: "d.js" });
  const d = sb.d;
  const fragments = d.FRAGMENTS || [];
  const singleWord = fragments.filter(r => /^[A-Za-z]+$/.test(String(r[0])));
  const values = [...new Set(Object.values(d.EXACT || {}).filter(v => typeof v === "string"))];

  const hits = [];
  for (const val of values) {
    if (!(/[A-Za-z]{2}/.test(val) && /[一-鿿]/.test(val))) continue;
    for (const rule of singleWord) {
      if (new RegExp("\\b" + esc(rule[0]) + "\\b", "i").test(val)) {
        hits.push({ val, term: rule[0], to: rule[1] });
        break;
      }
    }
  }
  const terms = [...new Set(hits.map(h => h.term + "→" + h.to))];
  console.log(
    name.padEnd(6) + String(fragments.length).padStart(7) + String(singleWord.length).padStart(10) +
    String(hits.length).padStart(16) + "  " + (terms.slice(0, 3).join(",") || "-").padEnd(16) +
    (hits[0] ? JSON.stringify(hits[0].val) : "")
  );
  for (const h of hits.slice(0, 6)) console.log("        · " + JSON.stringify(h.val) + "  ⟲ " + h.term + "→" + h.to);
}
