/**
 * locPak delivery probe, round 3 (2026-09-25).
 *
 * Round 1 (Community zone, A380 keys): UNKNOWN + AIRCRAFT — both silent.
 * Round 2 (Community2024 zone, A380 keys): UNKNOWN zh-CN + AIRCRAFT vendor-casing + en-US —
 *          ALL silent (user-verified screenshots; checklist channel not observed).
 * Round 3 hypothesis (user): the ini A380 is a marketplace/streamed package and may be
 * special. Control aircraft = Fenix A320 — a plain Community (fs20) package, old-engine
 * TT: key references, ships ONLY en-US.locPak (no zh-CN at all). If community locPak
 * delivery works for ANY package on this install, it works for Fenix.
 *
 *   F  zzz-JCH-tooltip-probe-f  Community  UNKNOWN   zh-CN.locPak   battery 1 switch
 *   G  zzz-JCH-tooltip-probe-g  Community  AIRCRAFT  zh-CN.locPak   APU master switch
 *   H  zzz-JCH-tooltip-probe-h  Community  AIRCRAFT  en-US.locPak   generator 1 switch (language insurance:
 *                                                            if the game resolves en-US this shows regardless)
 *   K  zzz-JCH-tooltip-probe-k  C24        UNKNOWN   zh-CN.locPak   checklist key 380.AFTERSTART ONLY — the round-2
 *                                                            free channel nobody observed; no hovering needed
 *
 * Fenix verdict matrix (full restart, Fenix A320 cold & dark, electrical panel + APU + glareshield):
 *   battery 1 -> 【探针F】  => channel works; A380 streamed/vendor scope is the variable -> pivot to vendor-fill
 *   APU master -> 【探针G】 => same, and content_type UNKNOWN irrelevant on fs20 too
 *   generator 1 -> 【探针H】=> the string table works but the game resolves en-US -> re-ship everything as en-US
 *   nothing    => community locPak delivery is dead on this install entirely; the only remaining
 *                 channel is in-place vendor locPak filling (needs user consent + backups)
 *   K (A380 checklist AFTER START -> 【探针K】) proves the string table loads community zh-CN even if
 *   the IM-tooltip path never resolves — decides whether A380 needs vendor-fill or XML-shadowing.
 *
 *   node tools/tooltip-zh/build-probe.mjs [--out <packagesRoot>] [--clean] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeCommunityPackage, validateLayout, buildLocPakJson } from './pack.mjs';

const argv = process.argv.slice(2);
const ROOT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'F:/games/community';
const CLEAN = argv.includes('--clean');
const DRY = argv.includes('--dry');
const C24 = path.join(ROOT, 'Community2024');

const PKGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'k'].map((s) => `zzz-JCH-tooltip-probe-${s}`);

const PROBES = [
  {
    dir: 'zzz-JCH-tooltip-probe-f',
    community: path.join(ROOT, 'Community'),
    contentType: 'UNKNOWN',
    file: 'zh-CN.locPak',
    lang: 'zh-CN',
    keys: {
      'FNX320.TOOLTIPS.Electrical_Battery_1_Button.ON': '【探针F】接通电池1',
      'FNX320.TOOLTIPS.Electrical_Battery_1_Button.OFF': '【探针F】断开电池1',
    },
  },
  {
    dir: 'zzz-JCH-tooltip-probe-g',
    community: path.join(ROOT, 'Community'),
    contentType: 'AIRCRAFT',
    file: 'zh-CN.locPak',
    lang: 'zh-CN',
    keys: {
      'FNX320.TOOLTIPS.APU_Master_Button.ON': '【探针G】接通APU主电门',
      'FNX320.TOOLTIPS.APU_Master_Button.OFF': '【探针G】断开APU主电门',
    },
  },
  {
    // vendor-impersonation leg: Fenix/iniBuilds manifests both use package_order_hint
    // CUSTOM_SIMOBJECTS while every probe so far used PANEL_PATCH — if the localization
    // enumerator filters by package kind, only this leg can ever show
    dir: 'zzz-JCH-tooltip-probe-i',
    community: path.join(ROOT, 'Community'),
    contentType: 'AIRCRAFT',
    orderHint: 'CUSTOM_SIMOBJECTS',
    file: 'zh-CN.locPak',
    lang: 'zh-CN',
    keys: {
      'FNX320.TOOLTIPS.Electrical_Battery_2_Button.ON': '【探针I】接通电池2',
      'FNX320.TOOLTIPS.Electrical_Battery_2_Button.OFF': '【探针I】断开电池2',
    },
  },
  {
    dir: 'zzz-JCH-tooltip-probe-h',
    community: path.join(ROOT, 'Community'),
    contentType: 'AIRCRAFT',
    file: 'en-US.locPak',
    lang: 'en-US',
    keys: {
      'FNX320.TOOLTIPS.Electrical_Generator_1_Button.ON': '【探针H】EN-TEST gen 1 on',
      'FNX320.TOOLTIPS.Electrical_Generator_1_Button.OFF': '【探针H】EN-TEST gen 1 off',
    },
  },
  {
    dir: 'zzz-JCH-tooltip-probe-k',
    community: C24,
    contentType: 'UNKNOWN',
    file: 'zh-CN.locPak',
    lang: 'zh-CN',
    keys: {
      '380.AFTERSTART': '【探针K】启动后',
    },
  },
];

function removeProbeDirs() {
  for (const zone of ['Community', 'Community2024']) {
    for (const p of PKGS) {
      const abs = path.join(ROOT, zone, p);
      if (fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: true, force: true });
        console.log(`removed ${zone}/${p}`);
      }
    }
  }
}

if (CLEAN) {
  removeProbeDirs();
  process.exit(0);
}

console.log(`# packages root: ${ROOT}  (round 3: Fenix A320 control legs + A380 checklist leg)${DRY ? '  [dry]' : ''}`);
for (const p of PROBES) {
  const abs = path.join(p.community, p.dir);
  const payload = { [p.file]: buildLocPakJson(p.lang, p.keys) };
  if (DRY) {
    console.log(`\n## ${p.dir} zone=${path.basename(p.community)} content_type=${p.contentType} file=${p.file}`);
    for (const [k, v] of Object.entries(p.keys)) console.log(`   ${k}\n        -> ${v}`);
    continue;
  }
  const { entries } = writeCommunityPackage(abs, {
    manifest: { title: `Tooltip probe ${p.dir.slice(-1).toUpperCase()} (round 3)`, version: '0.0.3' },
    contentType: p.contentType,
    orderHint: p.orderHint ?? 'PANEL_PATCH',
    files: payload,
  });
  const v = validateLayout(abs);
  console.log(`\n## ${p.dir} zone=${path.basename(p.community)} content_type=${p.contentType} file=${p.file} entries=${entries.length} layout-ok=${v.ok}`);
  if (!v.ok) console.log('   LAYOUT ERRORS:\n   ' + v.errors.join('\n   '));
  for (const [k, val] of Object.entries(p.keys)) console.log(`   ${k}\n        -> ${val}`);
}
if (!DRY)
  console.log(
    `\n# Deployed. Requires a FULL sim restart (2024 caches the package list at boot).\n# Remove ALL probes with: node tools/tooltip-zh/build-probe.mjs --clean`
  );
