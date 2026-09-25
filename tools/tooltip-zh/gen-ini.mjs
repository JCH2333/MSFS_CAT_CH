/**
 * iniBuilds family (A340 / A350 / A380) cockpit-tooltip dictionary generator.
 *
 * Unlike Fenix, iniBuilds DOES ship a zh-CN.locPak — the problem is its content:
 *   A340  3,360 tooltip keys, 346 left as literal English
 *   A350  3,736 tooltip keys, all but 1 left as literal English
 *   A380  2,207 tooltip keys, all left as literal English (and no loose en-US file at all,
 *         so zh-CN itself is the English source)
 *
 * Resolution order is deliberately conservative:
 *   vendor's own Chinese  ->  sibling inheritance (same label, other index digit)  ->
 *   authored table        ->  frames
 * so nothing here invents wording that the vendor already uses. Where we DO deviate
 * (a vendor mistranslation) it is listed in CONFLICTS and reported, never silent.
 *
 *   node tools/tooltip-zh/gen-ini.mjs <a340|a350|a380> [--write] [--show N]
 */
import fs from 'node:fs';
import { readLocPak, listLocPakFiles, isTooltipKey } from './lib.mjs';
import { compile, loadTermbase, siblingLayer } from './dict-engine.mjs';
import { PRESERVE } from './rules-common.mjs';

const PKGS = {
  a340: 'F:/games/community/Community/inibuilds-aircraft-a340',
  a350: 'F:/games/community/Community2024/inibuilds-aircraft-a350',
  a380: 'F:/games/community/Official2024/Steam/inibuilds-aircraft-a380',
};
const WHO = process.argv[2];
if (!PKGS[WHO]) {
  console.error('usage: gen-ini.mjs <a340|a350|a380> [--write] [--show N]');
  process.exit(2);
}
const WRITE = process.argv.includes('--write');
const SHOW = process.argv.includes('--show') ? +argvVal('show') : 25;
function argvVal(k) {
  return process.argv[process.argv.indexOf('--' + k) + 1];
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const DIGITS = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '20', '40', '80', '100', '160', '320', '640', '1000'].map((d) => [d, d]));

function load(dir) {
  const ps = listLocPakFiles(dir);
  const enP = ps.find((p) => /^en-us$/i.test(p.language));
  const zhP = ps.find((p) => /^zh-cn$/i.test(p.language));
  const src = enP ?? zhP;
  if (!src) throw new Error(`no locPak in ${dir}`);
  return {
    source: readLocPak(src.file).strings,
    vendorZh: zhP ? readLocPak(zhP.file).strings : {},
    usingZhAsEnglish: !enP,
  };
}

/** The vendor's own translated pairs across the whole family — inheritance substrate. */
const allPairs = [];
for (const dir of Object.values(PKGS)) {
  const { source, vendorZh } = load(dir);
  for (const [k, v] of Object.entries(source)) {
    if (!isTooltipKey(k)) continue;
    const zh = vendorZh[k];
    if (zh && zh !== v && /[㐀-鿿]/.test(zh)) allPairs.push({ en: norm(v), zh: norm(zh) });
  }
}
/**
 * Inheritance substrate: the vendor's own translated pairs across the ini family PLUS the
 * whole shipped term base (fs-base official Chinese included), because a sibling may well
 * have been translated by Asobo rather than by iniBuilds ("GEN 1" -> 发电机1 is fs-base).
 */
const termbaseRows = [...loadTermbase().entries()].map(([en, zh]) => ({ en, zh }));
const ALL_PAIRS = [...termbaseRows, ...allPairs];
const siblings = siblingLayer(ALL_PAIRS);

/**
 * Authored labels. Every line is either standard Airbus panel vocabulary or follows the
 * vendor's own rendering for the same family elsewhere (noted where it does).
 */
const EXACT = {
  // --- fuel jettison (A340 overhead / fuel panel)
  'JETTISON ARM': '抛油预位',
  'JETTISON ARM GUARD': '抛油预位保护',
  'JETTISON ACTIVE': '抛油作动',
  'JETTISON ACTIVE GUARD': '抛油作动保护',
  'SET JETTISON ARM': '设置抛油预位',
  'SET JETTISON ACTIVE': '设置抛油作动',
  'TEAR': 'TEAR（撕裂绳）',
  // --- fuel pumps: vendor renders FUEL ENGx only in English, so this is new wording
  'FUEL ENG1 MAIN PUMP': '1 号发动机主燃油泵',
  'FUEL ENG2 MAIN PUMP': '2 号发动机主燃油泵',
  'FUEL ENG3 MAIN PUMP': '3 号发动机主燃油泵',
  'FUEL ENG4 MAIN PUMP': '4 号发动机主燃油泵',
  'FUEL ENG1 STANDBY PUMP': '1 号发动机备用燃油泵',
  'FUEL ENG2 STANDby PUMP': '2 号发动机备用燃油泵',
  'FUEL ENG2 STANDBY PUMP': '2 号发动机备用燃油泵',
  'FUEL ENG3 STANDBY PUMP': '3 号发动机备用燃油泵',
  'FUEL ENG4 STANDBY PUMP': '4 号发动机备用燃油泵',
  'FUEL ENG1 XFEED': '1 号发动机交输阀',
  'FUEL ENG2 XFEED': '2 号发动机交输阀',
  'FUEL ENG3 XFEED': '3 号发动机交输阀',
  'FUEL ENG4 XFEED': '4 号发动机交输阀',
  'FUEL TRANSFER CENTER': '中央油箱输送泵',
  'FUEL TRANSFER LEFT CENTER PUMP': '左侧中央油箱输送泵',
  'FUEL TRANSFER RIGHT CENTER PUMP': '右侧中央油箱输送泵',
  // --- standby instruments (fs-base renders "standby attitude indicator" 备用姿态指示器)
  'STANDBY ATTITUDE INDICATOR': '备用姿态指示器',
  'PULL TO CAGE': '拉动以锁定陀螺',
  'PULL TO SET STANDBY ATTITUDE INDICATOR': '拉动以调整备用姿态指示器',
  'STANDBY SPEED BUG 1': '备用速度游标 1',
  'STANDBY SPEED BUG 2': '备用速度游标 2',
  'STANDBY SPEED BUG 3': '备用速度游标 3',
  'STANDBY ALTIMETER BUG 1': '备用高度表游标 1',
  'STANDBY ALTIMETER BUG 2': '备用高度表游标 2',
  'STANDBY ALTIMETER BUG 3': '备用高度表游标 3',
  'STANDBY ALTIMETER BUG 4': '备用高度表游标 4',
  // --- door locking system
  'DOOR LKG SYS CTL': '舱门锁定系统控制',
  'DOOR LKG SYS CTL GUARD': '舱门锁定系统控制保护',
  'DOOR LKG SYS CTL OPEN': '舱门锁定系统控制—打开',
  'DOOR LKG SYS CTL GUARD OPEN': '舱门锁定系统控制保护—打开',
  // --- observer station
  'CPT SUN VISOR': '机长遮阳板',
  'OBSERVER OXY MASK PRESSURE TEST': '观察员氧气面罩压力测试',
  'OBSERVER OXY MASK OVERPRESSURE TEST': '观察员氧气面罩超压测试',
  // --- avionics / cabin systems labels: house style keeps ubiquitous abbreviations bare
  'ACARS PRINT OUT': 'ACARS 打印',
  'DATA LOADER A': '数据装载器 A',
  'DATA LOADER B': '数据装载器 B',
  'SELECT DATA LOADER A TYPE': '选择数据装载器 A 类型',
  'SELECT DATA LOADER B TYPE': '选择数据装载器 B 类型',
  'GEN 3': '发电机3',
  'GEN 4': '发电机4',
  'SET GEN 3': '设置发电机3',
  'SET GEN 4': '设置发电机4',
  'CMC1': 'CMC 1',
  'CMC 1': 'CMC 1',
  'CMC 2': 'CMC 2',
  'FMGEC 1': 'FMGEC 1',
  'FMGEC 2': 'FMGEC 2',
  'ATSU 1': 'ATSU 1',
  'SATCOM': 'SATCOM（卫星通信）',
  'ACARS': 'ACARS',
  'ACMS': 'ACMS',
  'CPMS': 'CPMS（客舱便携式维护系统）',
  'CBMU': 'CBMU（蜂窝网络移动单元）',
  'CTU': 'CTU（通信传输单元）',
  'PVIS': 'PVIS（乘客视听系统）',
  'TFTS': 'TFTS（客舱电话系统）',
  'STP': 'STP',
  'TO SEL B': '至 SEL B',
  'SPARE': '备用',
  'REMOVE': '移除',
  'GPS': 'GPS',
  'IR1': 'IR1',
  'IR2': 'IR2',
  'IR3': 'IR3',
  // --- engine 3/4 wording follows the vendor's own ENG1/ENG2 rendering (no spaces: 发动机1引气)
  'ENG3 ICE': '发动机3防冰',
  'ENG4 ICE': '发动机4防冰',
  'ENG4 BLEED': '发动机4引气',
  'ENG4 MASTER CUTOFF': '发动机4主切断',
  'ENG3 FIRE': '发动机3消防',
  'ENG4 FIRE': '发动机4消防',
  'ENG3 FIRE GUARD': '发动机3消防保护',
  'ENG4 FIRE GUARD': '发动机4消防保护',
  'ENGINE 3 FIRE': '发动机3消防',
  'ENGINE 4 FIRE': '发动机4消防',
  'ENGINE 3 MAN START GUARD': '发动机3人工起动保护',
  'ENGINE 4 MAN START GUARD': '发动机4人工起动保护',
  // DELIBERATE DEVIATION from the vendor, recorded in CONFLICTS below:
  // iniBuilds renders fire "AGENT" as 动力机构 (actuator). In a fire-protection line
  // AGENT is the extinguishing charge, so we use 灭火剂.
  'ENG3 AGENT 1': '发动机3灭火剂1',
  'ENG3 AGENT 2': '发动机3灭火剂2',
  'ENG4 AGENT 1': '发动机4灭火剂1',
  'ENG4 AGENT 2': '发动机4灭火剂2',
  'MAN START 3': '人工起动3',
  'MAN START 4': '人工起动4',
  'MAN START 3 GUARD': '人工起动3保护',
  'MAN START 4 GUARD': '人工起动4保护',
  'ELEC IDG3': '电动整体驱动发电机3',
  'ELEC IDG4': '电动整体驱动发电机4',
  'ELEC IDG3 GUARD': '电动整体驱动发电机3保护',
  'ELEC IDG4 GUARD': '电动整体驱动发电机4保护',
  'SET IDG3 GUARD': '设置整体驱动发电机3保护',
  'SET IDG4 GUARD': '设置整体驱动发电机4保护',
  'FADEC ENG3': 'FADEC发动机3',
  'FADEC ENG4': 'FADEC发动机4',
  'FADEC ENG3 GUARD': 'FADEC发动机3保护',
  'FADEC ENG4 GUARD': 'FADEC发动机4保护',
  'SET ENG3 FADEC GND PWR GUARD': '设置发动机3 FADEC地面电源保护',
  'SET ENG4 FADEC GND PWR GUARD': '设置发动机4 FADEC地面电源保护',
  'FLT CTL PRIM1 GUARD': '飞行操纵主计算机1保护',
  'FLT CTL SEC 1 GUARD': '飞行操纵扰流板计算机1保护',
  // --- symbols and single characters used as MCDU keycap legends
  '+/-': '+/-', '.': '.', '/': '/', '←': '←', '': '',
};

/** Bare state/action legends. Values follow the vendor's own rendering where it exists
 *  (iniBuilds writes PRESS as 按下 in 828 keys) and fs-base's official Chinese otherwise. */
const TOKENS = {
  PRESS: '按下',
  OPEN: '打开',
  CLOSE: '关闭',
  ON: '开启',
  OFF: '关闭',
  NORM: '正常位',
  ARM: '预位',
  SPARE: '备用',
  REMOVE: '移除',
  SET: '设置',
  PULL: '拉动',
  ROTATE: '旋转',
  ADJUST: '调整',
  DEPLOY: '放出',
  STOW: '收好',
  USE: '使用',
};

/** Words that stay English because they are avionics legends, not prose. */
const KEEP = ['ADK 1', 'T.O', 'R', 'L', 'C'];

const PATTERNS = [
  // "SET <label>" is the A340/A380 switch-position tooltip; vendor wording is 设置<label>
  [/^SET (.+)$/, (m) => {
    const inner = norm(m[1]);
    if (EXACT[inner]) return '设置' + EXACT[inner];
    if (siblings.has(inner)) return '设置' + siblings.get(inner);
    const tb = loadTermbase().get(inner);
    return tb ? '设置' + tb : null;
  }],
  [/^(\d+) NM$/, (m) => `${m[1]} 海里`],
  [/^(.+?) GUARD$/, (m) => {
    const inner = norm(m[1]);
    const zh = EXACT[inner] ?? siblings.get(inner) ?? loadTermbase().get(inner);
    return zh ? `${zh}保护` : null;
  }],
  [/^(.+?) INCREMENTS$/, (m) => (`增量 ${m[1]}`)],
];

// Per-aircraft authored tables. They are separate files on purpose: A340/A350/A380 wording
// differs enough that one shared table keeps getting overwritten, and separate files let the
// aircraft be worked on independently. Absent file = no extra entries.
let extra = { EXACT: {}, PATTERNS: [] };
try {
  const mod = await import(`./authored-${WHO}.mjs`);
  extra = { EXACT: mod.EXACT ?? {}, PATTERNS: mod.PATTERNS ?? [] };
} catch {
  /* no authored table for this aircraft yet */
}

/*
 * rules-common PRESERVE is written for the HTML engines, where ON/OFF/AUTO are behaviour
 * judging tokens. In an ini tooltip these same words ARE the displayed text, and the game's
 * own Chinese translates them (开启/关闭/自动), so keeping them English here would leave
 * hundreds of bubbles half-translated. Everything else stays preserved.
 */
const INI_DISPLAY_TOKENS = new Set(['ON', 'OFF', 'AUTO', 'MAN', 'NORM', 'OPEN', 'CLOSE', 'ARM', 'SPARE', 'REMOVE']);
const iniPreserve = PRESERVE.filter((p) => !INI_DISPLAY_TOKENS.has(p));

const { source, vendorZh, usingZhAsEnglish } = load(PKGS[WHO]);
const tooltipKeys = Object.keys(source).filter(isTooltipKey);
const need = tooltipKeys.filter((k) => {
  const zh = vendorZh[k];
  return !zh || norm(zh) === norm(source[k]) || !String(zh).trim();
});
const subset = Object.fromEntries(need.map((k) => [k, source[k]]));

const { dict, todo, provenance, audit: probs } = compile(subset, {
  PRESERVE: [...iniPreserve, ...KEEP],
  EXACT: { ...EXACT, ...(extra.EXACT ?? {}), ...TOKENS, ...DIGITS },
  PATTERNS: [...PATTERNS, ...(extra.PATTERNS ?? [])],
}, { siblings, pairs: ALL_PAIRS });

const tally = {};
for (const p of Object.values(provenance)) tally[p] = (tally[p] ?? 0) + 1;
console.log(`# ${WHO}${usingZhAsEnglish ? ' (zh-CN used as the English source: no loose en-US in package)' : ''}`);
console.log(`# tooltip keys=${tooltipKeys.length}  vendor already Chinese=${tooltipKeys.length - need.length}  to fill=${need.length}`);
console.log(`# filled: ${Object.keys(dict).length}  TODO: ${todo.length}  provenance: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`# sibling layer available: ${siblings.size} labels | pairs indexed: ${ALL_PAIRS.length}`);
console.log(`# audit: latinLeftover=${probs.latinLeftover.length} unbalanced=${probs.unbalanced.length} tooLong=${probs.tooLong.length} empty=${probs.empty.length}`);
for (const p of probs.latinLeftover.slice(0, 10)) console.log(`   LATIN  ${p.en} -> ${p.zh}  ${p.words ? '[' + p.words.join(',') + ']' : ''}`);
for (const p of probs.unbalanced.slice(0, 6)) console.log(`   PAREN  ${p.en} -> ${p.zh}`);
const seen = new Set();
console.log('\n## TODO (unresolved — nothing invented)');
for (const t of todo) {
  if (seen.has(t.en)) continue;
  seen.add(t.en);
  if (seen.size > SHOW) break;
  console.log('   ' + t.en);
}
console.log(`# distinct TODO strings: ${new Set(todo.map((t) => t.en)).size}`);

if (WRITE) {
  const out = `.local-lab/tooltip/dict-ini-${WHO}.json`;
  fs.writeFileSync(out, JSON.stringify({ dict, todo }, null, 1));
  console.log(`# wrote ${out}`);
}
