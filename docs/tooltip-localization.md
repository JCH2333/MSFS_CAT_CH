# 座舱悬浮提示汉化（Cockpit Tooltip Localization）

开发日期 2026-09-24。状态：**全部机模座舱悬浮提示汉化开发完毕（2026-09-25）**。locPak 通道：Fenix/A340/A350/A380 四机模已实机验收通过（词条进机模自己包，fill-vendor.mjs 逐文件备份）；遮蔽通道：PMDG 737（676 条）/iFly 737MAX（378 条）/MD-11（599 条，RPN 宏感知分段翻译）已部署进各自 zzz- overlay 包待实机验收。A220 官方中文已覆盖、C919X 无提示。发布形态待设计。

## 回滚记录（2026-09-24）

四个包全部退回改前状态，`tools/tooltip-zh/revert-tooltip.mjs` 逐文件哈希比对确认与备份**字节一致**：

| 包 | 退回版本 | layout 条目 | zh-CN.locPak |
| --- | --- | --- | --- |
| zzz-JCH-fenix-a320-efb-zh-patch | 0.1.1 | 5 | 已移除 |
| zzz-JCH-a340-efb-zh-patch | 0.1.2 | 7 | 已移除 |
| zzz-JCH-a350-efb-zh-patch（Community + Community2024） | 0.2.0 | 38 | 已移除 |
| zzz-JCH-a380-efb-zh-patch | 0.1.11 | 9 | 已移除 |

四个 tooltip 构建产物（fenix v0.1.2 / inia340 v0.1.3 / ini350 v0.2.1 / inia380 v0.1.12）已移出
`local-patches/`，暂存 `.local-backups/rolled-back-tooltip-builds/`，避免被误安装；其余历史构建包全部原样保留。

**A380 的 `--fix-sizes` 一并回滚**，即该包 layout.json 声明尺寸小于磁盘实际大小的既有缺陷**照原样存在**。
它由上游 build 脚本改写 CSS/JS 后不重算尺寸导致，与本功能无关，是否单独修需要另行决定。

## 流程教训：批量部署前没跑单点探针

技能流程里「阶段6 离线验证 → 阶段7 实机验证」之后才谈部署与发布，本轮把顺序做反了：
在**社区包 locPak 是否并入全局表、`content_type: "UNKNOWN"` 能否携带语言包**这两点都还没证实的情况下，
一次性把四个机型都改了包并部署，其中一个还顺带动了 layout 尺寸。结果是功能整台没生效，
且引入了与词条无关的不明副作用，只能整体回滚。

## 2026-09-25 静态取证补强（全部本机一手证据）

1. **本机包根与双社区目录机制**。MSFS2024 的 `InstalledPackagesPath` = `F:\games\community`
   （`%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt`），其下 `Community` 与 `Community2024`
   **都会被扫描**：Content.xml 的注册名前缀分别是 `communityfs20-`（2020 兼容包）与
   `communityfs24-`（2024 原生包）。A380 本体在 `Official2024\Steam\inibuilds-aircraft-a380`（机模 v1.0.1），
   A380 补丁只部署在 `Community` 且 EFB 部分实机有效 → 该目录扫描无虞。注意
   `%APPDATA%\...\Content.xml` 本身是 2025-08 的陈旧缓存，不能当现行清单读。
2. **content_type 静态证据一边倒**。本机所有已知携带 locPak 且生效的包——厂商 A380、
   FBW A380X（`flybywire-aircraft-a380-842`）、Fenix `fnx-aircraft-320`、ini A340——manifest 级
   `content_type` 全部是 `"AIRCRAFT"`；locPak 都放**包根**；layout 条目只有 path/size/date（厂商包多一个
   hash 字段），**没有任何包在 layout 条目里写 content_type**。我们的补丁包 manifest 是 `"UNKNOWN"`。
   探针 A/B 隔离的正是这一个变量。
3. **厂商 A380 的 zh-CN 现状**：3,139 键中 2,207 条 tooltip 键**全部是英文占位串**（`FEED TANK 1 MAIN
   FUEL PUMP`、`PRESS TO TOGGLE` 这类），零翻译。推论：中文游戏语言下 A380 座舱提示现在就是英文；
   且探针覆盖 stub 即同时回答 Q4（后加载包能否盖掉厂商 zh-CN 占位）。
4. **上一轮失败包法证（v0.1.12 回滚包解包比对）**：产物本身完全规范——locPak 信封正确、3,139 键、
   无 BOM、layout 仅 +1 条目（path/size/date）、版本号 0.1.12。**文件构造没有毛病，失败必然出在
   加载语义**，探针是决定性实验。（2026-09-25 构建的合并包 locPak 与该产物逐键一致，作回归基准。）

## 2026-09-25 探针三轮实录

**第一轮（Community 区，A380 键）：A、B 都沉默**。用户实机截图：`FEED TANK 1 MAIN FUEL PUMP`/
`PRESS TO TOGGLE`/`ON`、`APU MASTER`、`MASTER WARNING` 全部仍英文；状态行显示 "ON"=按键 OFF 时
提示按下将接通，与厂商占位语义一致。结合 Windows `PreferredUILanguages=zh-CN`（游戏 UI 语言即中文），
zh-CN 字符串根本没有被读取——fs20 兼容区的社区包 locPak 投递不工作，content_type 不是（唯一）变量。

顺带的静态发现：MSFS2024 把基础游戏本地化拆成**独立流式官方包** `fs24-fs-base-localization`
（`StreamedPackages/` 下，本地只有空壳目录，内容按需云端流）——2024 的本地化是官方专包管理的思路。

**第二轮（Community2024 原生区，A380 键）：C、D、E 全部沉默**。设计：C=UNKNOWN/`zh-CN.locPak`
（主警告RIGHT+检查单 AFTER START）、D=AIRCRAFT/厂商同款小写 `zh-cn.locpak`（APU+检查单 APU 行）、
E=AIRCRAFT/`en-US.locPak`（语言保险位）。其中检查单键（免悬停通道）用户未观察到。至此 A380 上的
矩阵已扫满：两区 × 两 content_type × 两种文件名大小写 × zh-CN/en-US 全部无效——**问题不在这些变量，
在机模本身或投递通道整体**。用户判断：**A380 是市场云端串流包，可能因此特殊**（其内容经 Addon
Manager 的 fspatch 体系管理，fsmetadata-v1.json 记录 zip 分片与补丁链）。

**第三轮（已部署，等一次完整重启判定）**：对照组 = **Fenix A320**（普通 Community fs20 包、
旧引擎 `TT:` 键、厂商只有 en-US 一份语言包——若社区 locPak 投递在本机对任何包可行，对它就可行）：

| 包 | 区 | content_type | 文件 | 键（厂商 en-US 原值已核对） |
| --- | --- | --- | --- | --- |
| `…probe-f` | Community | UNKNOWN | zh-CN.locPak | 电池1 电门 ON/OFF →【探针F】接通/断开电池1 |
| `…probe-g` | Community | AIRCRAFT | zh-CN.locPak | APU 主电门 ON/OFF →【探针G】接通/断开APU主电门 |
| `…probe-i` | Community | AIRCRAFT + **`package_order_hint: CUSTOM_SIMOBJECTS`**（仿冒厂商形态） | zh-CN.locPak | 电池2 电门 ON/OFF →【探针I】接通/断开电池2 |
| `…probe-h` | Community | AIRCRAFT | en-US.locPak | 发电机1 电门 →【探针H】EN-TEST（语言保险位） |
| `…probe-k` | C24 | UNKNOWN | zh-CN.locPak | 仅检查单 `380.AFTERSTART` →【探针K】启动后（第二轮没人看的免悬停通道，补测） |

注：`package_order_hint` 是第三轮新增变量——Fenix 与 ini A340 厂商包都是 `CUSTOM_SIMOBJECTS`，
我们的补丁与探针此前全是 `PANEL_PATCH`，本地化枚举器有可能按包类别过滤（layout 条目形态已比对，
厂商与探针完全一致、无 hash 字段，该变量已排除）。

**判定矩阵**（Fenix 冷舱，看电瓶1/APU 主电门/发电机1/电瓶2）：
- F 或 G 命中 → 通道对普通包可行，**A380 串流包是特殊因素** → A380 转厂商 locPak 原地填充通路，Fenix 走社区包投递；
- 仅 I 命中 → **本地化枚举按包类别过滤**，正式补丁把 manifest 改成 CUSTOM_SIMOBJECTS 即通；
- 仅 H 命中 → 字符串表工作但游戏按 en-US 解析（或 en-US 走包根遮蔽）→ 全部词条改投 en-US 重来；
  同时顺手看一眼电池1提示：若显示异常/键名/空白，说明探针 H 的根级 en-US.locPak 把 Fenix 自己的整表遮蔽了（根路径跨包遮蔽语义实锤）；
- 全沉默 → 社区 locPak 投递在本机整体不通 → 唯一剩余通路=原地填充厂商 locPak（须用户同意+完整备份）；
- K 命中（A380 EFB 检查单 AFTER START 行）→ 社区 zh-CN 进了字符串表，死的只是 IM-tooltip 解析路径 → A380 走 XML 遮蔽。

**同场次可选观察（零部署成本，信息量大）**：
1. 进一次 FBW A380X（`flybywire-aircraft-a380-842`，自带 17 份 locPak 含完整中文）看座舱提示是否中文——命中=社区 zh-CN 投递对该包有效；
2. ini A340（厂商 zh-CN 有 1,002 条真实翻译）看其已译键是否中文——命中=市场厂商包 zh-CN 正常加载，仅"新增包"被排除。

## 2026-09-25 深夜 II：硬编码机模（PMDG/iFly/MD-11）遮蔽通路开发完成

四机模实机验收通过后，最后三家硬编码字面量机模走 **XML 遮蔽通路**（厂商文件零改动，overlay 包
同路径盖文件；还原=删 overlay 文件与 layout 条目，天然满足"只备被改文件"——厂商原件根本不动，
另存 `.local-lab/tooltip/hardcoded-<名>.base.json` 记录被遮蔽厂商文件的哈希供日后 rebase）：

| 机模 | 厂商包 | 字符串 | 遮蔽文件 | 部署目标 |
| --- | --- | --- | --- | --- |
| PMDG 737 | `Community2024/pmdg-aircraft-737` | 676 条（1,394 处） | 21 个行为 XML（客舱/外部也扫到） | 并入 `zzz-JCH-pmdg-efb-zh-patch` |
| iFly 737MAX | `Community/ifly-aircraft-737max8` | 378 条（3,458 处） | 3 个 INTERIOR 变体（model+VCStyle×2） | 新独立包 `zzz-JCH-ifly-cockpit-zh-patch` |
| TFDi MD-11 | `Community/tfdidesign-aircraft-md11` | 599 条（640 处） | 19 个行为 XML | 并入 `zzz-JCH-tfdi-md11-efb-zh-patch` |

**工具链**（tools/tooltip-zh/）：`extract-hardcoded.mjs` 提取（大小写不敏感元素匹配——PMDG/iFly 用
`<TooltipID>`，MD-11 用全大写 `<TOOLTIPID>`，旧扫描因大小写漏了 MD-11 与 PMDG 客舱文件）→
`gen-hardcoded.mjs` 词典（termbase+EXACT+SEGMENTS+SEG_PATTERNS；**MD-11 的 RPN 宏串做宏感知分段
翻译**：`%((...))%`/`%{if}`/`{:N}`/`!1.1f!` 等令牌原样保留、只译文本段，分隔符共享是坑）→
`deploy-hardcoded.mjs` 遮蔽部署（逐文件计数硬门禁：词典覆盖数≠文件实例数即拒绝，防漂移）。

**词典证据链**：termbase 命中 + 手写 EXACT（PMDG 386 条/iFly 371 条/MD-11 283 条 extra.json）
+ SEG_PATTERNS 家族（MD-11 座位站位音量/源/方式、跳开关名、油箱泵）+ 保留表（单字符键盘提示、
FS2CREW/WLAN/CHR、ADF1 类专名）。三家 todo 全部归零。

**边界**：MD-11 模板里 `#TOOLTIPID#` 占位串原样保留；A220 官方中文已覆盖、C919X 无提示——
至此**全部机模的座舱悬浮提示汉化开发完毕**，待一轮实机验收。遮蔽文件基于当日厂商原版，
厂商更新后须重跑（extract→deploy 自动 rebase 校验哈希，变化即拒）。

## 2026-09-25 深夜 V：777 系列座舱汉化 + 水印层级统一调整

**777**：提取 77W（520 条/901 处）与 77F（严格子集），以 737+738 词典为底补译 407 条缺口
（authored-hardcoded-pmdg-77w.mjs，777 命名体系：L/R ENG、VHF L/C/R、STAB CUTOUT、放油喷嘴等）。
已注入 pmdg-aircraft-77w（3 文件）与 pmdg-aircraft-77f（3 文件），残留英文均为保留键位。

**水印层级统一调整**：全部 EFB 引擎的署名徽章从 99999/999999/2147483000/2147483646 统一降为
**z-index:1**（8 引擎源 14 处）——厂商基础层 0-10、弹窗层 2000-20000，徽章压 DOM 序仍浮在基础
面板上、但彻底让位弹窗与提示。踩坑：正则交替 99999|999999 前缀匹配留残（fenix 变 z-index:19），
且 build-shadow 吃 built/ 缓存必须重跑 build-host。**Fenix 已重部署验证**（发布形态，水印 z-index:1
+ 无 diag 残留）；A380/A350/A340/PMDG/MD-11/A220 源码已改，重部署待下一批次。

## 2026-09-25 深夜 IV：两处修正

1. **PMDG 仍英文的真因**：用户飞的是 737-800，其行为文件在**独立变体包 【pmdg-aircraft-738】**
   （Content.xml 注册 communityfs24-pmdg-aircraft-738），此前只注入了 -700 基座包。已对 738 包
   完成提取（674 条，与 737 词典仅差 2 条 BBJ 安全隔离带词）并就地注入 20 个文件。
   -700 的注入保留（飞 -700 同样有中文）。PMGD 还有 77F/77W 独立包在本机，如需同批处理可复用管线。
2. **MD-11 宏裸显的真因**：原生气泡**从不展开** TFDi 行为里的 RPN 模板（英文原版同样裸显
   %((..))/%%{else} 等）——保留宏毫无意义。词典改为**拍平静态标签**：控制名+（状态选项并列），
   如【温度（主货舱甲板/中客舱）】【右 风挡雨刷（关/间歇/慢速/快）】。重注入 19 文件，
   零裸宏、零英文残留。inject-hardcoded 新增 --force（以备份原件为底套新词典）与 738 目标。

## 2026-09-25 深夜 III：实机判定 PMDG/MD-11 遮蔽无效 → 改就地注入

实测：iFly 遮蔽**生效**；PMDG/MD-11 仍英文。取证结论：**行为文件的加载解析在厂商包内部**——
PMDG 用 `<IncludeBase RelativeFile="73X_Cockpit_Behavior.xml"/>`（附件系统相对包含）、TFDi 用
包内 `<Include ModelBehaviorFile=..>` 行为解析，跨包遮蔽根本拦不到。iFly 能成是因为其模型级行为
文件（model/xxx_INTERIOR.xml）随模型经 VFS 解析。

**处置**：`undeploy-hardcoded.mjs` 撤掉两包无效遮蔽（layout 恢复：pmdg 23 条、md11 4 条，均 valid）；
`inject-hardcoded.mjs` **就地注入**厂商文件（词典不变）。备份按用户指示逐文件：
`.local-backups/vendor-injection/<包名>/` 存原件+manifest（PMDG 21 文件 2.5MB、MD-11 19 文件 0.6MB，
首触记录、永不覆盖）。完整性闸：当前哈希必须等于 base（未动）或 backup（已注入），否则判厂商更新拒绝。
PMDG 残留英文均为故意保留的键位缩写（ENT/CLR/CLB/CRZ/DES/TOGA/VHF1/LS 1-12 等面板 legend）。
**还原：`node tools/tooltip-zh/inject-hardcoded.mjs <pmdg-737|tfdi-md11> --clean`**。

## 2026-09-25 深夜：探针V命中 → 四机模量产填充完成

**探针V 命中**（用户实机：Fenix 电瓶1 显示【探针V】），厂商通道定案。同场配载问题自愈（9977 数据
留档：WS GraphQL 通道全绿、订阅正常收推送——确认为慢启动时序竞态，非包问题）。

**量产**：`fill-vendor.mjs` 把词典合并进**机模自己包内**的 zh locPak（厂商非提示键全保留，
词典胜出），layout 尺寸原位更新（A380 的 hash 字段保留未重算），一次性完成四机模：

| 机模 | 厂商包 | 文件 | 结果 |
| --- | --- | --- | --- |
| Fenix A320 | `Community/fnx-aircraft-320` | zh-CN.locPak（新建，替换探针文件） | 1,208 键（175 条 ADF1/HF1 类专名按词典保留英文） |
| ini A340 | `Community/inibuilds-aircraft-a340` | zh-CN.locPak（覆盖，原文件已备份） | 4,963 键（厂商 1,002 条已译全保留+346 缺口新译） |
| ini A350 | `Community2024/inibuilds-aircraft-a350` | zh-CN.locPak（覆盖，原文件已备份） | 3,959 键（3,735 词典键零缺失） |
| ini A380 | `Official2024/Steam/inibuilds-aircraft-a380` | zh-cn.locpak（覆盖，原文件已备份） | 3,139 键（2,207 提示键全量中译） |

**备份与还原**（按用户指示：只备被改文件，不备整机）：`.local-backups/vendor-injection/<包名>/`
存原始文件字节+manifest（首触记录，永不覆盖）。**逐包还原：`node tools/tooltip-zh/fill-vendor.mjs
<厂商包> --clean`**（创建的文件删除、修改的文件字节级还原）。

**边界与待办**：
- A380 是市场串流正品：layout 里 hash 字段未重算（算法未知），文件改动有被游戏完整性校验/Addon
  Manager 修复回滚的可能——实机启动后若报包异常立即 `--clean` 还原；
- Fenix 官方安装器将来更新机模会覆盖/清除注入文件，重装后需重跑 fill；
- 未覆盖：Fenix 43 条硬编码字面量、PMDG/MD-11/iFly 全硬编码（需 XML 遮蔽通路）；A380 检查单键
  （380.*，同文件可译，未来可选）；A220 官方中文已覆盖、C919X 无提示；
- 发布形态待设计：厂商注入的客户端安装动作（layout 合并）+ 水印体系接入，均未做——当前为本地验证形态；
- Fenix EFB 当前部署为 --diag 诊断构建（配载排查用），发布前须重跑不带 --diag 的构建。

**第三轮判定：F/G/I/H 全部沉默**（含 en-US 保险位 H——电池1 英文原样完好，也排除了根文件跨包遮蔽）。
至此结论：**独立探针包无论区/content_type/文件名/语言，都不进 MSFS2024 的本地化表**。

**决定性对照（用户实机观察）**：FBW A380X（`flybywire-aircraft-a380-842`，普通 Community 包）的座舱
提示**部分显示中文**（如「关闭辅助动力发电机」）——中文来自**它自己包内**的 zh-CN.locPak。
结论收敛：**MSFS2024 只读"机模自己包里"的语言文件；要汉化谁的座舱，词条就必须进谁的包。**

**第四轮回溯（2026-09-25 晚，已由量产取代）**：`build-vendor-probe.mjs` 把 `zh-CN.locPak`（电池1 电门
ON/OFF →【探针V】接通/断开电池1）直接放进 `fnx-aircraft-320` 包根并登记 layout（2074→2075 条）。
厂商 manifest 未动（2.4.0.4720）。原 layout.json 备份于 `.local-backups/vendor-probe-fenix/`。
**一键还原：`node tools/tooltip-zh/build-vendor-probe.mjs --clean`**。
风险注记：Fenix 官方安装器将来更新包时可能覆盖/清除该文件（探针阶段可接受）。

**判定**：V 命中 → 量产通路=词条进机模自己包。A380（市场串流包）对应动作为**原地填充厂商
`zh-cn.locpak` 的 2,207 条英文占位**（4GB 市场正品，动前须用户同意+完整备份+单键试点+可还原）。
V 不命中 → 只剩改写厂商既有 locPak 值的路子，另行调研。

## 2026-09-25 A380 合并包已构建（未部署、未发布，版本号保持 0.1.11）

按用户决定：**并入本地未发布的 v0.1.11，不升版本号**。`build-a380-merge.mjs` 流程与结果：

- 前置校验：已部署副本与 v0.1.11 指纹逐文件一致（回滚态干净）才允许构建。
- 基于已部署副本暂存 → `emit-patch.mjs --dict dict-ini-a380.json --base 厂商包 --fix-sizes`。
- **--fix-sizes 修正了 6 条 layout 声明尺寸**（上游 build 脚本改写 CSS/JS 后不重算的既有缺陷；
  emit 对不一致 layout 硬门禁，让包自我描述变真。用户如不同意可从备份回退此 6 条，其余不受影响）。
- 产物 `zh-CN.locPak`：3,139 键（厂商底表 + 我们的 2,207 条 tooltip 词条），与回滚的 v0.1.12 产物
  **逐键一致**（回归基准通过）。
- **manifest 一字未动**：版本保持 0.1.11，`LastUpdate` 里的 L6 零宽水印原样保留。
- 产物（2026-09-25 第二次构建，等价内容）：`local-patches/msfs-cat-ch-inia380-efb-zh-cn-v0.1.11.zip`
  （30,957,878 字节，12 文件，SHA-256 `d16fc6ce3054d6d15137fde4653e8e6194563cf7159b7b5d238c0c5fcbd05554`）；
  每次构建的被替换产物按时间戳归档 `.local-backups/pre-merge-a380-v0111/<时间>/`，首次构建的
  tooltip 无关 v0.1.11 zip 也在第一级目录。
- **并行会话协作**：其他会话在持续扩充 v0.1.11 的 EFB 词典。合并脚本**以合并时刻的已部署 Community
  副本为基**（漂移列出并保留、不再拒绝），`--fix-sizes` 按当时磁盘重算全部声明尺寸。**并行改动落地后
  必须重跑 `node tools/tooltip-zh/build-a380-merge.mjs`** 再发布，否则合并产物不含最新词条。
- **未部署**。探针判定通过后执行 `node tools/tooltip-zh/build-a380-merge.mjs --deploy`（脚本自带部署前备份）。
  注意部署合并包前必须先移除探针包，避免标记键盖住正式词条。

（上节两段为 2026-09-24 的原计划；2026-09-25 已按该顺序推进：探针已改写为 A380 键版并部署，
A380 合并包已构建待命。探针判定通过后，其余机型按同一投递形态由 `emit-patch.mjs`/`deploy-tooltip.mjs`
套用，词典不用重做——词条与投递文件名解耦。A340 词条里的「灭火剂」措辞偏离、约 77 条「待实机确认」
A380 词条（客舱/IFE/维护板/气象雷达/推力手柄五类）仍待截图定夺。）


## 这个功能是什么

鼠标悬停在 3D 座舱电门/旋钮上弹出的小窗提示。原来只有 EFB 网页面板被汉化，
座舱里的物理电门提示仍是英文。本功能把这些提示也纳入汉化，并按机型补齐词条。

## 投递方式实测有三类（不是四类，也不是从文件名推的）

| 类别 | 语法 | 涉及机型 | 修法 |
| --- | --- | --- | --- |
| 键引用（旧引擎） | `<TooltipID>TT:FNX320.TOOLTIPS.X.PRESS</TooltipID>` | Fenix A320 | 追加 `zh-CN.locPak` |
| 键引用（2024 Interactions Manager） | `<IMTooltipsInstances>` 内 `<TTTitle>` `<TTDescription>` `<TTValue>` `<TTInteraction>`，值是**不带 `TT:` 前缀**的裸键 | ini A340/A350/A380、A220 | 追加 `zh-CN.locPak` |
| 硬编码英文字面量 | `<TooltipID>Battery Guard</TooltipID>` | PMDG 737、TFDi MD-11、iFly 737MAX | locPak 无效，只能遮蔽行为 XML（**尚未实施**） |

C919X 经全量 850 文件只读复核确认**没有任何座舱悬浮提示**（其 MouseRect 只有 Cursor 无 Tooltip），
无可汉化对象；Synaptic A220 的提示几乎全部引用基础游戏命名空间 `COCKPIT.TOOLTIPSV3.*`，
官方中文已覆盖，无需新增词条。

## 键解析是全局并集

运行时把所有已加载包的 `.locPak` 合成一张表：厂商包 + 基础游戏
`Packages/fs-base/zh-CN.locPak`（29,382 键，含 COCKPIT.TOOLTIPSV2 3141 / TOOLTIPS 1487 / TOOLTIPSV3 767）。
因此「厂商没翻」不等于「屏幕上是英文」——落在基础游戏命名空间的键早就是中文。
真正要补的是**没有任何包定义中文**的那部分，这才是词条量的正确口径。

## locPak 必须登记进 layout.json

`flybywire-aircraft-a320-neo/layout.json` 逐条列出 16 个语言文件，`fnx-aircraft-320` 列出 `en-US.locPak`。
只放文件不写条目 = 不加载。条目 `date` 是 18 位 FILETIME，`JSON.parse` 会丢低位，
所以 `tools/tooltip-zh/pack.mjs` 全程按文本拼接，写完再用文本读回逐项校验 size 与位数。
实测：写入后原有 5/7 条条目**逐字节不变**，只新增 1 条。

另注意：包内路径大小写不敏感（已装的 ini 补丁 layout 里是全小写路径，磁盘上是混合大小写），
校验器按小写键比对，否则会误报。

## 词条工程：三档证据，禁止硬译

`tools/tooltip-zh/dict-engine.mjs` 的解析顺序，任一档失败才进下一档，全失败进 TODO **不发明译文**：

1. `PRESERVE` 行为判定位与机型代号保留英文；
2. 机型手写表（`EXACT`）；
3. **术语库**：26,211 条真实（英,中）对，只从基础游戏官方中文、iniBuilds 自己的 zh-CN、FlyByWire 已发布中文里挖，不猜；
4. **同族继承** `siblingLayer`：iniBuilds 中文里索引数字一律写阿拉伯数字（`SET GEN 1`→设置发电机1），
   所以把已翻译兄弟词条的数字位按位置替换即可得到 `GEN 3`。这一层单独产出 **3,173** 条有依据的词条。
   中文与数字之间不存在 `\b` 词边界，必须 split/join 按位置替换（第一版因此静默失效过）；
5. 句式框架 `PATTERNS`（`Turn on X`/`Open X cover`/`Display X page on ECAM` …），
   名词槽由 `SUBJECTS` 词库填充，动词按**开关类别**选（电类接通/断开、灯类打开/关闭、
   活门舱门打开/关闭、方式类启用/停用），不是一律直译；
6. 剩余进 TODO，构建报告并拒绝假装完成。

审计门禁：中文里残留未注释英文词、括号不配对、值为空串（会把本来有英文的一行变成空白）、
以及「缩写注释里含缩写自身」的二次扩展缺陷，全部拦下。

术语核实来源按优先级：已发布同源词典（`.local-lab/dict-precedent.mjs`）→
本机 Obsidian 航空知识库（`tools/tooltip-zh/vault-terms.mjs`，按系统分概念页 + 各机型 FCOM 文本）→
基础游戏官方中文。本轮据此**改错两处**：
`MASTER CAUTION`=主警戒、`MASTER WARNING`=主警告（初稿按词面写反）；`DITCHING`=水上迫降（初稿误作迫降密封）。

## 与厂商既有译法的冲突（已记录，未静默采用）

iniBuilds 把防火面板的 `AGENT`（灭火剂）译成「动力机构」。本轮在 A340 表中按「灭火剂」处理
（`ENG3 AGENT 1` → 发动机3灭火剂1），与厂商其余 `发动机N消防保护` 等措辞保持一致。
**这属于故意偏离，需人工确认后决定是否回退到厂商写法。**

## 本轮产出与状态

| 机型 | 词条状态 | 本机版本 | 发布 |
| --- | --- | --- | --- |
| Fenix A320 | 1,208 键全覆盖，TODO 0（厂商原本完全没有中文） | `zzz-JCH-fenix-a320-efb-zh-patch` **0.1.1 → 0.1.2** | 未发布 |
| ini A340 | 346 缺口全补，TODO 0；locPak 以厂商 4,963 键为底，防按文件覆盖语义下回退 | `zzz-JCH-a340-efb-zh-patch` **0.1.2 → 0.1.3** | 未发布 |
| ini A350 | 3,736 待补全部解决，TODO 0（同族继承 3,173 条 + 手写 755 条 + 框架） | `zzz-JCH-a350-efb-zh-patch` **0.2.0 → 0.2.1**，双 community 同时部署 | 未发布 |
| ini A380 | 2,207 键全覆盖，TODO 0；locPak 以厂商 3,139 键为底 | `zzz-JCH-a380-efb-zh-patch` **0.1.11 → 0.1.12** | 未发布 |
| PMDG / MD-11 / iFly | 硬编码字面量，需 XML 遮蔽通路，**未实施** | — | — |
| A220 | 官方中文已覆盖，无需改动 | — | — |
| C919X | 无悬浮提示 | — | — |

## 复核阶段抓到的四个缺陷（已全部修）

交付后按「逐条检查翻译是否正确」的要求复查产物，发现的问题都不是词条问题而是引擎问题：

1. **ini 系把 `ON/OFF/AUTO/NORM/OPEN/CLOSE` 当行为判定位保留了英文**。这些词在 HTML 引擎里确实不能翻，
   但在 ini 的 tooltip 值里就是显示文本，官方中文是翻的。修正后 A380 的 preserve 从 410 降到 32、
   A350 从 330 降到 61，三百多个原本半英半中的气泡变成全中文。
2. **`gen-ini.mjs` 合并手写表时展开错了对象**（`...extra` 而非 `...extra.EXACT`），
   导致 A350/A380 手写条目被静默丢弃、只剩兜底框架在工作。表现为 exact 计数不变，属静默失效。
3. **同族继承用 `\b` 定位数字**：中文与阿拉伯数字之间不存在词边界，`设置发电机1` 里 `\b1\b` 永不匹配，
   整层静默产出 0 条。改为按数字位置 split/join 后该层实际产出 3,173 条。
4. **`fs.cpSync` 在本机静默复制 0 个文件且不报错**，一度把部署做成了空包。改为自己写的 `copyTree()`
   并断言「复制文件数 === 源文件数」。

## 顺带查出的既有缺陷：ini A380 补丁包 layout.json 尺寸失真

追加 locPak 前的强制校验挡下了一次部署：已装的 `zzz-JCH-a380-efb-zh-patch` v0.1.11 里，
6 个被遮蔽的 `html_ui` 文件在磁盘上的实际大小**全部大于** layout.json 声明值
（例：`ini-efb-a380-ext.css` 声明 162,053、实际 163,240）。比对 `local-patches/` 里的构建产物后确认：
**包内文件与已构建 ZIP 一致，是 layout.json 沿用了厂商原文件的旧尺寸没跟着更新**，
即 A380 的构建脚本在改写 CSS/JS 之后没有重算声明尺寸。

实机上该补丁此前工作正常，说明 sim 容忍尺寸不符，但让包自我描述失真不可取。
`emit-patch.mjs --fix-sizes` 按磁盘真实字节修正了这 6 条声明并逐条打印，其余字段与日期保持不变。
**上游待办**：A380 工程 `build-*.ps1` 应在改写文件后重算 layout 尺寸，否则每次构建都会重现。
其余 5 个已装补丁包（a340/a350/fenix/a220/md11/pmdg）校验全部通过，无此问题。

另有两处我怀疑是错的，核实后**证明我错、代理对**，记录以免下次又被「想当然」带偏：

- `PUSH/PULL` 不该改成「按压/拉起」——fs-base 官方 `Push/Pull` = 推/拉，ini A340 自己的 `PUSH`=推、`PULL`=拉，
  「推/拉」才是产品线一致写法。
- `STBY COMPASS` 不该改成「备用罗盘」——ini A340 自己写 `SET STBY COMPASS LT` = 设置备用指南针灯。
  注意这里存在一个真实的口径分歧：fs-base 官方对 compass 用「罗盘」，厂商用「指南针」。
  按「同厂商优先继承既有写法保产品线一致」保留「指南针」，**分歧留档待人工统一**。

代理标注 `待实机确认` 的条目：69 行 + 2 族 ≈ 77 条 A380 词条，集中在五类——客舱专属词汇（TAP/SHOWER/TOILET/
BAR/CURTAIN/乘务员座椅，只有键名可作证据）、A380 IFE 网络术语（CWS/IFEC/NSS/OIT）、维护板与时钟板专名
（GATELINK、OVHT COND FAN、elapsed/reference/adjust）、气象雷达缩写（VD/ELEVN、TCAS ABV/BLW）、
以及「推力手柄」（8 条，无任何来源）。这些均按「查不到就不硬译」保留原文并加注释，等实机截图定夺。



原有补丁的既有改动一行未动：新版本是在已装包副本上**追加** `zh-CN.locPak` + 一条 layout 条目 +
manifest 版本号，随后打包进 `local-patches/` 并生成 fingerprint。原始包备份在
`.local-backups/tooltip-<时间戳>/`。

工具链（本机私有，gitignore 内）：`tools/tooltip-zh/`
`inventory.mjs` 盘点 · `corpus.mjs` 引用键与缺口口径 · `extract-refs.mjs`+`mb.mjs` ModelBehavior 模板解释器 ·
`termbase.mjs` 术语库 · `vault-terms.mjs` 知识库核证 · `gen-fenix.mjs`/`gen-ini.mjs`+`rules-common.mjs`+`dict-engine.mjs` 词典 ·
`pack.mjs`+`emit-patch.mjs`+`deploy-tooltip.mjs` 追加与部署 · `build-probe.mjs` 实机探针。

## 尚未证实、必须实机判定的四件事（`build-probe.mjs` 一次跑完）

1. 社区包的 `zh-CN.locPak` 是否真的并入全局字符串表；
2. 补丁包 `content_type: "UNKNOWN"` 是否被加载，还是必须声明 `"AIRCRAFT"`（探针 A/B 双包同时验证）；
3. 我们缺键时气泡是回落英文、显示原始键、还是留白；
4. `zzz-` 后加载能否覆盖厂商未译的 zh-CN（决定 ini 系是否必须像 A340 那样带全量底表）。

在这四项通过实机验证之前，按项目规则不得上传发布。
