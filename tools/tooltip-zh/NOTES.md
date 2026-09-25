# 座舱悬浮提示（tooltip）汉化 — 调研留痕

2026-09-24 只读调研结论。全部来自本机包内一手文件，不是从文件名推断。

## 悬浮提示的投递方式实测有三类

| 类别 | 语法 | 出现机型 | 能否用 locPak 修 |
| --- | --- | --- | --- |
| 键引用（旧引擎） | `<TooltipID>TT:FNX320.TOOLTIPS.X.PRESS</TooltipID>` | Fenix A320、TFDi MD-11 的模板参数 | 能 |
| 键引用（2024 Interactions Manager） | `<IMTooltipsInstances>` 内的 `<TTTitle>` `<TTDescription>` `<TTValue>` `<TTInteraction>` `<TTInteractionLockable>`，值为**不带 `TT:` 前缀**的裸键 | ini A340/A350、Synaptic A220 | 能 |
| 硬编码英文字面量 | `<TooltipID>Battery Guard</TooltipID>` | PMDG 737、TFDi MD-11、iFly 737MAX、C919X | **不能**，只能遮蔽该 XML 文件 |

还有第四种：`<TOOLTIP_ID>NAME</TOOLTIP_ID>` + `<IE_TOOLTIP_DESCRIPTION_ID>@TT_Package.ACTION.OPEN</IE_TOOLTIP_DESCRIPTION_ID>`
（A220、ini 舱门）。`@TT_Package.` 在 fs-base 与厂商 locPak 里都查不到同名键，展开语义未证实，标记待实机判定。

## 键的解析范围是全局并集

运行时把**所有已加载包**的 `.locPak` 合并成一张表：厂商自己的 `zh-CN.locPak` + 基础游戏
`Packages/fs-base/zh-CN.locPak`（29,382 键，含 COCKPIT.TOOLTIPSV2 3141 / TOOLTIPS 1487 / TOOLTIPSV3 767）。
所以「厂商没翻」不等于「屏幕上显示英文」——键若落在 `COCKPIT.TOOLTIPSV3.*` 上，官方中文已经翻好了
（实测 `COCKPIT.TOOLTIPSV3.ACTION.OPEN_CLOSE` → 「打开/关闭」）。真正要补的只是没有任何包定义过中文的那部分。

## locPak 必须同时登记进 layout.json

`flybywire-aircraft-a320-neo/layout.json` 用 16 条条目逐个列出各语言 locPak，`fnx-aircraft-320` 列出 `en-US.locPak`。
只在目录里放文件、不写 layout 条目 = 不会被加载。条目 `date` 是 18 位 FILETIME，
`JSON.parse` 会丢低位，只能按文本拼接、写完再逐项校验 size（见 `pack.mjs`）。

## 七机型实测缺口（corpus.mjs 产出，`.local-lab/tooltip/corpus-*.json`）

| 机型 | 引用键 | 已有中文 | 中文与英文相同（未译） | 无人定义 | 硬编码字面量 |
| --- | --- | --- | --- | --- | --- |
| Fenix A320 | 1,095 | 0 | 0 | 1,056（+39 未展开占位符） | 43 |
| ini A340 | 1,493 | 1,002 | 139 | 352 | 0 |
| ini A350 | 1,468 | 12 | 1,249 | 207 | 3 |
| PMDG 737 | 0 | — | — | — | 582 |
| TFDi MD-11 | 模板内，raw 扫约 600 | — | — | — | 约 600 |
| Synaptic A220 | 8（6 已翻） | 6 | 0 | 2 | 0 |
| iFly 737MAX | 0 | — | — | — | 378 |

- Fenix 的 1,056 是真空白：厂商只有 `en-US.locPak`（1,208 键），压根没有中文包。
- ini A350 的 1,249 是「厂商塞了 zh-CN 但整份照抄英文」，与 A340 的同名控制件词条高度重叠，可继承。
- A340/A350 的「无人定义」里有 `COCKPIT.TOOLTIPSV2.TITLE.*`、`COCKPIT.TOOLTIPSV2.ACTION.OPEN_CLOSE`
  这类基础游戏**只剩 V3 版本**的旧键（`...TOOLTIPSV3.TITLE.COMMON_SERVICE_DOOR` 存在，V2 不存在）。
  说明厂商引用了过期命名空间；是否运行时回落到 V3 未证实，待实机。
- PMDG / iFly / MD-11 / C919X 完全没有 locPak，提示词写死在行为 XML 里。

## 未证实、必须实机判定的四件事

见 `build-probe.mjs` 文件头：社区包 locPak 是否并入全局表、`content_type: "UNKNOWN"` 是否被加载、
缺键时回落到英文还是显示原始键、`zzz-` 后加载能否覆盖厂商未译的 zh-CN。
