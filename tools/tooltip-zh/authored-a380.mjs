/**
 * iniBuilds A380 — authored cockpit hover-tooltip strings.
 *
 * Nothing here is invented: every value is either standard Airbus panel vocabulary, the
 * wording the vendor/Asobo already ships for the same family (checked with
 * `tools/tooltip-zh/termbase.mjs --grep`, `vault-terms.mjs`, `.local-lab/dict-precedent.mjs`
 * and the published ini EFB dictionaries), or is flagged `// 待实机确认` on its own line.
 *
 * WHY THE TABLE IS ALSO WIRED IN AS A PATTERN
 * ---------------------------------------------------------------------------
 * gen-ini.mjs consumes `extra.EXACT` directly, so the table below is normally applied at
 * the EXACT stage. The first pattern is the same table as an anchored alternation: it
 * costs nothing while EXACT wins, and it keeps this file working unchanged against the
 * earlier generator revision that spread the module namespace (`...extra`) and therefore
 * only read `extra.PATTERNS`.
 *
 * The engine also rejects any pattern result that equals its English input
 * (`if (!out || out === en …) continue`), which is exactly what the keycap legends A-Z / 0
 * and the ADIRS knob legends "ADR 1" / "IR 1" / "VOR 1" / "ADF 1" produce. Those are
 * returned with one trailing space; `norm()` strips it again, so the stored value is the
 * plain legend — the same result the shipping DIGITS/PRESERVE/KEEP layers produce.
 *
 *   node tools/tooltip-zh/gen-ini.mjs a380 --show 40
 */
import { loadTermbase } from './dict-engine.mjs';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* =========================================================================
 * 1. Action / verb lines (shared across many switches, hence high leverage)
 * ========================================================================= */
const ACTIONS = {
  'PRESS TO TOGGLE': '按下以切换', // fs-base "Push to toggle" -> 推动以切换; iniBuilds writes 按下 for PRESS
  'PRESS TO SELECT': '按下以选择',
  'PRESS TO ACTIVATE': '按下以启用',
  'PRESS TO CALL': '按下以呼叫',
  'PRESS TO DISCHARGE': '按下以释放',
  'PRESS TO DISCONNECT': '按下以断开',
  'PRESS TO RELEASE': '按下以释放',
  'PRESS TO OPERATE': '按下以作动',
  'PRESS TO RESET': '按下以重置',
  'PRESS TO TRANSMIT': '按下以发射',
  'PRESS TO SILENCE AURAL': '按下以静音音响', // fs-base "Aural warning" -> 音响警报
  'PRESS TO SILENCE THE HORN IN THE COCKPIT': '按下以静音驾驶舱喇叭',
  'PRESS TO POWER THE APU': '按下以给APU供电',
  'PRESS TO START THE APU': '按下以起动APU',
  'PRESS TO START/STOP/RESET': '按下以启动/停止/重置', // ini-a340 "START/STOP CHRONO" -> 启动/停止计时器
  'PRESS TO TOGGLE VALVES': '按下以切换活门',
  'PRESS TO TOGGLE, ROTATE TO SET VOLUME': '按下切换，旋转设置音量',
  'PRESS TO DISPLAY MORE INFORMATION': '按下以显示更多信息',
  'PRESS TO RECALL': '按下以调回',
  'PRESS TO REMOVE EWD/SD LINE': '按下以清除显示行', // E/WD + SD record lines on the ECP CLR keys
  'LIFT TO PRESS BUTTON': '抬起护罩以按下电门',
  'LIFT TO ACCESS FIRE BUTTON': '抬起以取用消防电门',
  'LIFT TO ACCESS CONTROLS': '抬起以取用操纵件',
  'CLICK TO TOGGLE': '点击以切换',
  'MOVE TO SELECT': '移动以选择',
  'MOVE SELECTION BOX UP': '上移选择框',
  'MOVE SELECTION BOX DOWN': '下移选择框',
  'ROTATE TO SET': '旋转以设置', // fs-base "Rotate to adjust" -> 旋转以调整
  'ROTATE TO SELECT': '旋转以选择',
  'ROTATE TO SET BRIGHTNESS': '旋转以设置亮度',
  'ROTATE TO SET VOLUME': '旋转以设置音量',
  'ROTATE TO SELECT BATTERY': '旋转以选择电池',
  'ROTATE TO SELECT SPEED': '旋转以选择速度',
  'SWITCH TO SET': '拨动以设置',
  'TOGGLE TO SET': '切换以设置',
  'PUSH TO TOGGLE': '推动以切换',
  'SINGLE PRESS +, DOUBLE PRESS -': '单击为+，双击为-',
  'OPEN BOTH GUARDS TO OPERATE SYSTEM': '打开两个护罩以操作系统',
  'SCROLL WHEEL': '滚动轮',
  'SCROLL UP': '向上滚动',
  'SCROLL DOWN': '向下滚动',
  'SCROLL LEFT': '向左滚动',
  'SCROLL RIGHT': '向右滚动',
  'SCROLL TO DESTINATION': '滚动至目的地',
  'DISPLAY SOFT KEYBOARD': '显示软键盘',
  'MOVES THE CURSOR TO THE DISPLAY TO THE LEFT': '将光标移至左侧显示器',
  'MOVES THE CURSOR TO THE DISPLAY TO THE RIGHT': '将光标移至右侧显示器',
  'MOVES THE CURSOR TO THE ND': '将光标移至ND（导航显示）',
  'CURSOR LEFT NAVIGATION KEY': '光标左移键',
  'CURSOR RIGHT NAVIGATION KEY': '光标右移键',
  'CURSOR CONTROL POWER SWITCH': '光标控制电源电门',
  'KEYBOARD POWER SWITCH': '键盘电源电门',
  'DECREASE SELECTION/BRIGHTNESS': '减少选择/亮度',
  'INCREASE SELECTION/BRIGHTNESS': '增加选择/亮度',
  'SET OPTION/TOGGLE QNH/STANDARD': '设置选项/切换气压基准',
  'PUSH/PULL TO TOGGLE, ROTATE TO SET': '推/拉切换，旋转设置', // fs-base "Push/Pull" -> 推/拉
  'PUSH/PULL TO TOGGLE MANAGED/SELECTED SPEED, ROTATE TO SET': '推/拉切换速度托管/选择，旋转设置', // fs-base 速度托管模式
  'PUSH/PULL TO TOGGLE MANAGED/SELECTED VERTICAL MODE, ROTATE TO SET': '推/拉切换垂直模式托管/选择，旋转设置',
  'PUSH/PULL TO TOGGLE NAV/HDG, ROTATE TO SET HEADING': '推/拉切换导航/航向，旋转设置航向',
  'PUSH TO LEVEL OFF, PULL TO SELECT VS MODE, ROTATE TO SET': '推以改平，拉以选择垂直速度模式，旋转设置', // ini-a340 "LEVEL OFF" -> 矫直飞机
  'SELECT STATION THAT CAN INITIATE THE EVAC COMMAND': '选择可发起撤离指令的位置',
  'SELECT OIT SETTING': '选择机载信息终端设置',
};

/* =========================================================================
 * 2. Labels — grouped by panel, wording traces the source noted on the line
 * ========================================================================= */
const LABELS = {
  // --- cabin water service (upper deck). No vault entry for either word; key names
  //     (A380_WaterFlowA/B, UD_SHOWERROOM_*) are the only evidence.
  'TAP': '水龙头', // 待实机确认
  'SHOWER': '淋浴间', // 待实机确认
  'SHOWER DOOR': '淋浴间门', // 待实机确认
  'SHOWER DOOR LOCK': '淋浴间门锁', // 待实机确认

  // --- ADIRS panel: ADR / IR are the panel legends themselves (dict-engine allowlist),
  //     ADIRS follows iniBuilds' own full form (A340 zh-CN: 大气数据惯性基准系统1) — see FAMILIES

  // --- air conditioning / pressurisation
  'CABIN AIR EXTRACT VALVES': '客舱空气排出活门',
  'CABIN AIR EXTRACT GUARD': '客舱空气排出活门保护',
  'AIR FLOW SELECTOR': '气流选择器', // fs-base "Cabin air control (air flow…)" -> 客舱空气控制（气流…）
  'CABIN TEMPERATURE SELECTOR': '客舱温度选择器',
  'COCKPIT TEMPERATURE SELECTOR': '驾驶舱温度选择器',
  'AIR CROSS BLEED': '交输引气', // fs-base "Cross bleed selector" -> 交输引气选择器
  'PROBE/WINDOW HEAT AUTO/MANUAL': '探头/风挡加温 自动/人工',
  'WING ANTI ICE': '机翼防冰', // fs-base "Turn ON wings anti-ice" -> 打开机翼防冰
  'CABIN PRESSURE ALTITUDE MODE SELECTOR': '客舱高度模式选择器',
  'CABIN PRESSURE ALTITUDE MANUAL TARGET SELECTOR': '客舱高度人工目标选择器',
  'CABIN PRESSURE VERTICAL SPEED MODE SELECTOR': '客舱垂直速度模式选择器',
  'CABIN PRESSURE VERTICAL SPEED MANUAL TARGET SELECTOR': '客舱垂直速度人工目标选择器',
  'DITCHING BUTTON': '水上迫降电门', // ini-a340 "DITCHING" -> 水上迫降

  // --- cabin/crew calls
  'CALL ALL CABIN STATIONS': '呼叫全部客舱位置',
  'ALL STATIONS EMERGENCY CALL': '全位置紧急呼叫',
  'FORWARD PILOT CREW REST CALL': '前机组休憩处呼叫', // ini-a340 "CAB REST" -> 客舱休憩处
  'AFT PILOT CREW REST CALL': '后机组休憩处呼叫',
  'CALL ALL LOWER CABIN STATIONS': '呼叫全部下层客舱位置',
  'CALL ALL UPPER CABIN STATIONS': '呼叫全部上层客舱位置',
  'MECHANIC CALL': '机务呼叫',
  'PURSER CALL': '乘务长呼叫', // 待实机确认
  'CAPTAIN': '机长',
  'CAPTAIN & PURSER': '机长与乘务长', // 待实机确认
  'CAPTAIN & PURSER SWITCH': '机长与乘务长电门', // 待实机确认

  // --- cargo smoke / temperature
  'BULK HOLD ISOLATION VALVES': '散装货舱隔离活门',
  'BULK HOLD TEMPERATURE SELECTOR': '散装货舱温度选择器',
  'FORWARD HOLD ISOLATION VALVES': '前货舱隔离活门',
  'FORWARD CARGO HOLD TEMPERATURE SELECTOR': '前货舱温度选择器', // fs-base "Aft cargo temp selector" -> 后货舱温度选择器
  'CARGO HOLD HEATER': '货舱加热器',
  'DISCHARGE': '释放', // fs-base "Cargo fire extinguisher agent discharge" -> 货舱灭火剂释放
  'DISCHARGE AGENT IN AFT HOLD': '向后货舱释放灭火剂',
  'DISCHARGE AGENT IN FORWARD HOLD': '向前货舱释放灭火剂',
  'CARGO SMOKE AGENT GUARD': '货舱烟雾灭火剂保护',

  // --- cursor control display / keyboard units
  'ESCAPE': '退出', // own A380 EFB patch: "EXIT" -> 退出
  'ATC COMMUNICATION': '空管通信',
  'ATC COMMUNICATION PAGE': '空管通信页',
  'BACKSPACE': '退格',
  'CLEAR INFO': '清除信息',
  'DESTINATION': '目的地机场',
  'DIRECT TO': '导航至', // fs-base "Direct to" -> 导航至
  'DIRECT TO PAGE': '导航至页',
  'FLIGHT PLAN PAGAE': '飞行计划页', // vendor typo for "FLIGHT PLAN PAGE" — keep the meaning
  'MAILBOX': '邮箱', // 待实机确认
  'MAILBOX PAGE': '邮箱页', // 待实机确认
  'NAV AIDS': '导航台',
  'NAV AIDS PAGE': '导航台页',
  'PERFORMANCE': '性能',
  'PERFORMANCE PAGE': '性能页',
  'SECONDARY INDEX': '次级索引', // 待实机确认
  'SECONDARY INDEX PAGE': '次级索引页', // 待实机确认
  'SURVEILLANCE': '监视',
  'SURVEILLANCE PAGE': '监视页',
  'INIT': '初始化', // ini-a340 "INIT PAGE" -> 初始化页面

  // --- cockpit door / intrusion
  'COCKPIT DOOR HANDLE': '驾驶舱门把手',
  'COCKPT DOOR DEADBOLT LOCK': '驾驶舱门锁栓', // 待实机确认 — "deadbolt" has no vault entry
  'COCKPIT DOOR LOCKING SYSTEM': '驾驶舱门锁定系统',
  'COCKPIT DOOR LOCKING SYSTEM GUARD': '驾驶舱门锁定系统保护',
  'COCKPIT DOOR LOCK': '驾驶舱门锁',
  'CABIN DOOR LEVER': '客舱门把手',
  'LANDSCAPE CAMERA DISPLAY FOR PASSENGERS': '旅客横向摄像显示器', // 待实机确认

  // --- observer station / cvr / toilets / seats (vendor renders OBSERVER as 观察员)
  'OBSERVER OXYGEN MASK PANEL': '观察员氧气面罩面板',
  'CVR ERASE': 'CVR清除', // house style keeps CVR bare; ini "ERASE" -> 清除
  'CVR TEST BUTTON': 'CVR测试电门',
  'TOILET DOOR': '卫生间门', // 待实机确认
  'TOILET LID': '马桶盖', // 待实机确认
  'TOILET FLUSH': '马桶冲水', // 待实机确认
  'SEAT BACKREST': '座椅靠背',
  'SEAT BAR': '座椅护栏', // 待实机确认
  'SEAT PANEL': '座椅面板',
  'SEAT DOOR': '座椅隔断门', // 待实机确认
  'SEAT CONTROL': '座椅调节', // 待实机确认
  'STORAGE DOOR': '储物门', // 待实机确认
  'FOOTREST': '脚托',
  'FOOT REST': '脚托',
  'TRAY TABLE': '托盘桌板', // ini-a340 "CPT TRAY" -> 机长托盘
  'BAR AREA': '吧台区域', // 待实机确认
  'CURTAIN': '帘幕', // 待实机确认
  'SEAT BELT LOCK': '座椅安全带锁',
  'SEAT ADJUSMENT': '座椅调节', // vendor typo for "SEAT ADJUSTMENT"
  'SEAT BELT SIGNS': '安全带标志灯',
  'NO MOBILE SIGNS': '禁止吸烟标志灯', // fs-base: "no smoke" prompt light -> 禁止吸烟提示灯
  'EMERGENCY EXIT SIGNS': '应急出口标志灯',
  'FLIGHT ATTENDANT SEAT': '乘务员座椅', // 待实机确认
  'OBSERVER SEAT': '观察员座椅',
  'OBSERVER ARMREST': '观察员扶手',
  'CAPTAIN ARMREST': '机长扶手', // ini-a340 "CPT LEFT ARMREST" -> 机长左扶手
  'FIRST OFFICER ARMREST': '副驾驶扶手',
  'OBSERVER/ENGINEER TRAY TABLE': '观察员/机务托盘桌板', // 待实机确认
  'CAPTAIN TRAY TABLE': '机长托盘桌板',
  'FIRST OFFICER TRAY TABLE': '副驾驶托盘桌板',
  'CAPTAIN TILLER/PEDAL DISCONNECT': '机长手轮/脚蹬断开', // vault 空客-起落架: 手轮（tiller）
  'FIRST OFFICER TILLER/PEDAL DISCONNECT': '副驾驶手轮/脚蹬断开',
  'AUTOPILOT DISCONNECT': '自动驾驶断开',

  // --- EFB (fs-base renders EFB as 电子飞行包)
  'EFB HIDDEN': '电子飞行包已隐藏',
  'EFB DISPLAYED': '电子飞行包已显示',
  'EFB DISPLAY/HIDE': '电子飞行包显示/隐藏',
  'EFIS OPTION': 'EFIS选项',
  'EFIS MODE SELECTOR': 'EFIS模式选择器', // ini-a340 "SET EFIS MODE" -> 设置电子飞行仪表系统模式
  'EFIS MODE': 'EFIS模式',
  'EFIS RANGE': 'EFIS距离',
  'LS': '仪表着陆系统', // RMP nav position / EFIS pb for the ILS; panel legend reads LS (fs-base ILS -> 仪表着陆系统) — 待实机确认
  'LS/DIRECT TO': '仪表着陆系统/导航至', // 待实机确认 — same LS reading on the ISIS knob pull action
  'STANDARD': '标准', // fs-base "Set barometric pressure to STANDARD" -> 将大气压设定为“标准”
  'CAPTAIN PRESSURE SELECTOR': '机长气压选择器',
  'FO PRESSURE SELECTOR': '副驾驶气压选择器',
  'ALTIMETER PRESSURE UNIT': '高度表气压单位',
  'in HG': 'inHg（英寸汞柱）',
  'VELOCITY VECTOR': '速度矢量', // fs-base "velocity vector" -> 速度矢量
  'ALTERNATE': '备用', // fs-base "TOGGLE ALTERNATE STATIC" -> 开/关备用静压源

  // --- electrical
  'AC ESSENTIAL FEED': '交流主汇流条供电', // ini-a340 verbatim
  'AC ESSENTIAL FEED GUARD': '交流主汇流条供电保护',
  'APU BATTERY': 'APU电池',
  'ESSENTIAL BATTERY': '重要电池', // fs-base "Essential BUS" -> 重要汇流条
  'COMMERCIAL LOADS 1': '商用负载1',
  'COMMERCIAL LOADS 2': '商用负载2',
  'CONNECTED': '已连接',
  'DISCONNECTED': '已断开',
  'ELECTRICAL LOAD MANAGEMENT UNIT': '电气负载管理单元', // vault A350 电气: Electrical Load Management Function -> 电气负载管理
  'GALLEY POWER': '厨房电源', // ini-a340 "GALLEY ELEC" -> 厨房电源
  'APU GENERATOR A': 'APU发电机A',
  'APU GENERATOR B': 'APU发电机B',
  'RAT MANUAL RELEASE': 'RAT人工释放',
  'RAT MANUAL RELEASE GUARD': 'RAT人工释放保护',

  // --- engine start / ignition
  'IGNITION/START': '点火/起动',

  // --- inflight entertainment power supplies (A380-only; no vault entry for any of them)
  'CABIN WORK STATION ELECTRICAL POWER': '客舱工作站电源', // 待实机确认
  'IN FLIGHT ENTERTAINMENT CENTER ELECTRICAL POWER': '客舱娱乐中心电源', // 待实机确认
  'NETWORK SERVER SYSTEM ELECTRICAL POWER': '网络服务器系统电源', // 待实机确认
  'NETWORK SERVER SYSTEM ELECTRICAL POWER GUARD': '网络服务器系统电源保护', // 待实机确认
  'NSS AVIONICS': '网络服务器系统航电', // 待实机确认
  'FLIGHT OPS': '飞行运行',
  'NSS DATA TO AVIONICS CONTROL': '网络服务器系统数据至航电控制', // 待实机确认
  'OIT SIDE': '机载信息终端侧', // 待实机确认
  'ONBOARD INFORMATION TERMINAL BRIGHTNESS': '机载信息终端亮度', // 待实机确认

  // --- evacuation
  'EVACUATION COMMAND': '撤离指令', // ini-a340 "EVAC COMMAND" -> 撤离指令
  'EVACUATION COMMAND GUARD': '撤离指令保护',
  'EVACUATION HORN OFF BUTTON': '撤离喇叭关断电门', // ini-a340 "EVAC HORN SHUTOFF" -> 撤离喇叭关闭

  // --- flight controls: PRIM/SEC indexes are expanded in FAMILIES below

  // --- FCU
  'ALTITUDE HOLD MODE': '高度保持模式', // fs-base verbatim
  'ALTITUDE KNOB': '高度旋钮',
  'ALTITUDE KNOB 100/1000 SELECTOR': '高度旋钮100/1000选择器',
  'APPROACH MODE': '进近模式', // fs-base verbatim
  // vault 商飞C919-FCOM-东航: 自动推力
  'AUTOTHRUST': '自动推力',
  'FCU WINDOWS BRIGHTNESS': 'FCU窗口亮度',
  'FCU INTEGRAL LIGHT': 'FCU整体照明',
  'FLIGHT DIRECTOR': '飞行指引仪', // fs-base verbatim
  'HEADING KNOB': '航向旋钮', // fs-base verbatim
  'LOCALIZER MODE': '航向道模式', // fs-base "Loc mode" -> 航向道模式
  'METER DISPLAY': '仪表显示',
  'SPEED KNOB': '速度旋钮',
  'SPEED/MACH TOGGLE': '速度/马赫切换',
  'HDG/VS-TRK/FPA TOGGLE': '航向/垂直速度-航迹/航径角切换',
  'TRUE/MAGNETIC TOGGLE': '真/磁切换',
  'VERTICAL SPEED KNOB': '垂直速度旋钮',

  // --- fire protection
  'DISCH': '释放', // DISCHARGE legend on the APU agent switch
  'APU FIRE EXTINGUISHER BOTTLE': 'APU灭火瓶',
  'APU FIRE BUTTON': 'APU消防电门',
  'APU FIRE BUTTON GUARD': 'APU消防电门保护',
  'FIRE TEST SWITCH': '消防测试电门',

  // --- fuel
  'CROSSFEED VALVE 1': '交输阀1', // ini-a340 "FUEL XFEED" -> 燃油交输
  'CROSSFEED VALVE 2': '交输阀2',
  'CROSSFEED VALVE 3': '交输阀3',
  'CROSSFEED VALVE 4': '交输阀4',
  'PRESS TO ACTIVATE THE JETTISON SYSTEM': '按下以使放油系统作动',
  'PRESS TO ARM THE JETTISON SYSTEM': '按下以预位放油系统',
  'FUEL JETTISON ACTIVE': '放油作动',
  'FUEL JETTISON ACTIVE GUARD': '放油作动保护',
  'FUEL JETTISON ARM': '放油预位',
  'FUEL JETTISON ARM GUARD': '放油预位保护',
  'EMERGENCY OUTER TANK TRANSFER': '应急外侧油箱传输',
  'EMERGENCY OUTER TANK TRANSFER GUARD': '应急外侧油箱传输保护',
  'INNER TANK TRANSFER': '内侧油箱传输',
  'INNER TANK TRANSFER GUARD': '内侧油箱传输保护',
  'MIDDLE TANK TRANSFER': '中部油箱传输',
  'MIDDLE TANK TRANSFER GUARD': '中部油箱传输保护',
  'OUTER TANK TRANSFER': '外侧油箱传输',
  'OUTER TANK TRANSFER GUARD': '外侧油箱传输保护',
  'TRIM TANK TRANSFER GUARD': '配平油箱传输保护', // vault A330/A380: Trim Tank -> 配平油箱
  'TRIM TANK FEED': '配平油箱供油',
  'TRIM TANK FORWARD TRANSFER': '配平油箱向前传输',
  'ISOLATE': '隔离',
  'FORWARD': '向前',

  // --- glare shield / chronometer
  'ATC MESSAGE': '空管报文', // 待实机确认 — ATC uplink message, no termbase hit for MESSAGE in this sense
  'AUTOLAND WARNING LIGHT': '自动着陆警告灯',
  'CAPTAIN\'S CHRONO': '机长计时器', // ini-a340 "CPT CHRONO" -> 机长计时器
  'FO\'S CHRONO': '副驾驶计时器',
  'CAPTAIN\'S LOUDSPEAKER': '机长扬声器', // fs-base "Speaker" -> 扬声器
  'FO\'S LOUDSPEAKER': '副驾驶扬声器',
  'MASTER CAUTION': '主警示', // fs-base "ACKNOWLEDGE MASTER CAUTION" -> 确认主警示
  'MASTER WARNING': '主警告', // fs-base "Master warning" -> 主警告
  'SLIDING TABLE LIGHT': '滑动桌板灯', // 待实机确认 — glare shield sliding table illumination

  // --- hydraulics
  'GREEN HYDRAULIC ELECTRIC PUMP A': '绿色液压电动泵A', // ini-a340 "SET GREEN HYD ELEC PUMP ON GUARD" -> 设置绿色液压电动泵开启保护
  'GREEN HYDRAULIC ELECTRIC PUMP B': '绿色液压电动泵B',
  'YELLOW HYDRAULIC ELECTRIC PUMP A': '黄色液压电动泵A',
  'YELLOW HYDRAULIC ELECTRIC PUMP B': '黄色液压电动泵B',
  'GREEN HYDRAULIC ELECTRIC PUMP A ON': '绿色液压电动泵A开启',
  'GREEN HYDRAULIC ELECTRIC PUMP B ON': '绿色液压电动泵B开启',
  'YELLOW HYDRAULIC ELECTRIC PUMP A ON': '黄色液压电动泵A开启',
  'YELLOW HYDRAULIC ELECTRIC PUMP B ON': '黄色液压电动泵B开启',
  'GREEN HYDRAULIC ELECTRIC PUMP A ON GUARD': '绿色液压电动泵A开启保护',
  'GREEN HYDRAULIC ELECTRIC PUMP B ON GUARD': '绿色液压电动泵B开启保护',
  'YELLOW HYDRAULIC ELECTRIC PUMP A ON GUARD': '黄色液压电动泵A开启保护',
  'YELLOW HYDRAULIC ELECTRIC PUMP B ON GUARD': '黄色液压电动泵B开启保护',

  // --- maintenance panel
  'AUTO GROUND TRANSFER': '自动地面转换',
  'BATTERY VOLTAGE SELECTOR': '电池电压选择器',
  'GATELINK': 'GATELINK（地面数据链插孔）', // 待实机确认 — no vault or termbase hit
  'MAINTENANCE GROUND CONNECTION': '维护地面连接',
  'MAINTENANCE GROUND CONNECTION BUTTON': '维护地面连接电门',
  'MAINTENANCE GROUND CONNECTION GUARD': '维护地面连接保护',
  'GROUND HF DATALINK': '地面HF数据链',
  'GROUND HF DATALINK GUARD': '地面HF数据链保护',
  'OVERHEAT CONDITIONING FAN RESET': '过热调节风扇重置', // 待实机确认 — "conditioning fan" wording unverified
  'OXYGEN RESET': '氧气重置',
  'REFUEL': '加油',
  'REMOTE CIRCUIT BREAKER CONTROL': '远程跳开关控制', // fs-base "circuit breaker" -> 断路器; 跳开关 is the Airbus-house form
  'SERVICE INTERPHONE OVERRIDE': '服务内话超控', // vault 空客-通信: 服务内话; fs-base override -> 超控
  'AVIONICS VENT GROUND COOLING': '航电通风地面冷却', // ini-a340 "GND COOL" -> 地面冷却
  'AVIONICS EXTRACT VALVE OVERRIDE': '航电排气活门超控',
  'OVERRIDE': '超控',
  'RECORDER GROUND CONTROL': '记录器地面控制', // ini-a340 "RECORDER GND CTL" -> 地面控制
  'STOP': '停止',
  'ELAPSED TIME CONTROL': '计时控制', // 待实机确认
  'CLOCK TIME REFERENCE': '时钟时间基准', // 待实机确认
  'RESET CHRONO': '重置计时器',
  'CLOCK TIME ADJUST': '时钟时间调整', // 待实机确认
  'CONSOLE AND FLOOR LIGHT': '控制台与地板灯',
  'FOOT WARMER SWITCH': '暖足器电门', // ini-a340 "CPT FOOT WARMER" -> 机长暖足器
  'CABIN FANS': '客舱风扇',
  'SUPPLEMENTAL COOLING SYSTEM': '辅助冷却系统', // 待实机确认
  'COAT SWITCH LIGHT': '外套区电门灯', // 待实机确认
  'AVIONICS SWITCH LIGHT': '航电区电门灯', // 待实机确认

  // --- ISIS (integrated standby instrument)
  'MODE': '模式',
  'DISARM': '解除', // fs-base "DISARM AUTOBRAKE" -> 解除自动制动
  'BTV': 'BTV（刹车至脱离）', // vault 空客A380-FCOM-官方: BTV（刹车至脱离）
  'HIGH': '高',
  'AUTOBRAKE MODE SELECTOR': '自动刹车模式选择器', // fs-base "Autobrakes selector" -> 自动刹车选择器
  'AUTOBRAKE REJECTED TAKEOFF MODE': '自动刹车中断起飞模式', // fs-base "RTO" -> 中断起飞
  'ANTI-SKID CONTROL': '防滑控制', // ini-a340 "ANTISKID" -> 防滑
  'LANDING GEAR GRAVITY EXTEND GUARD': '起落架重力展开保护', // ini-a340 "LDG GEAR GRAVITY EXTN GUARD" verbatim
  'GRAVITY EXTEND LEFT GUARD': '重力展开左护罩',
  'GRAVITY EXTEND RIGHT GUARD': '重力展开右护罩',
  'LANDING GEAR GRAVITY EXTENSION SELECTOR': '起落架重力展开选择器',
  'PARKING BRAKE': '停放刹车',
  'REINFLATE BRAKE ACCUMULATOR': '刹车蓄压器再充压', // 待实机确认
  'PITCH TRIM MANUAL SWITCH': '俯仰配平人工电门',
  'RUDDER TRIM KNOB': '方向舵配平旋钮',
  'PRESS TO RESET RUDDER TRIM': '按下以重置方向舵配平',
  'RUDDER TRIM RESET': '方向舵配平重置',
  'SPEED BRAKE LEVER': '减速板手柄', // vault MCDU 专题: 减速板
  'FLAPS LEVER': '襟翼操纵杆', // ini-a340 "FLAP LEVER" -> 襟翼操纵杆

  // --- display switching panel
  'CAPTAIN ON ADR3': '机长改用ADR3',
  'FO ON ADR3': '副驾驶改用ADR3',
  'AIR DATA SWITCHING': '大气数据切换', // ini-a340 "AIR DATA SELECT" -> 大气数据选择
  'CAPTAIN ON IR3': '机长改用IR3',
  'FO ON IR3': '副驾驶改用IR3',
  'IR SWITCHING': '惯导切换',
  'BOTH ON FMS1': '双侧改用飞行管理系统1',
  'BOTH ON FMS2': '双侧改用飞行管理系统2',
  'FMS SWITCHING': '飞行管理系统切换',
  'OIS ON/OFF SWITCH': 'OIS（机载信息系统）开关', // vault 空客A380-FCOM-官方: 机载信息系统（OIS）
  'DISPLAY UNIT RECONFIGURATION': '显示组件重新构型', // 待实机确认
  'LEFT MFD BRIGHTNESS': '左侧多功能显示亮度', // fs-base "MFD" -> 多功能显示
  'RIGHT MFD BRIGHTNESS': '右侧多功能显示亮度',
  'ND BRIGHTNESS': '导航显示亮度', // ini-a340 "CPT ND BRIGHTNESS" -> 机长导航显示亮度
  'WEATHER RADAR/TERRAIN BRIGHTNESS': '气象雷达/地形亮度',
  'PFD BRIGHTNESS': 'PFD亮度',
  'PFD/ND TRANSFER': 'PFD/ND转换',

  // --- lights
  'BEACON LIGHTS': '信标灯', // fs-base "SET BEACON LIGHTS" -> 设置信标灯
  'LANDING LIGHTS': '着陆灯', // fs-base "SET LANDING LIGHTS" -> 设置着陆灯
  'LOGO LIGHTS': '标志灯', // fs-base "SET LOGO LIGHTS" -> 设置标志灯
  'NAVIGATION LIGHTS': '导航灯', // fs-base "SET NAV LIGHTS" -> 设置导航灯
  'TAKE OFF': '起飞', // nose light switch position of LIGHTS_EXT_NOSE (title: 标志灯)
  'STROBE LIGHTS': '频闪灯', // ini-a340 "STROBE LTS" -> 频闪灯
  'TURNOFF & CAMERA LIGHTS': '脱离灯与摄影灯', // 待实机确认
  'WING LIGHTS': '机翼灯', // ini-a340 "WING LTS" -> 机翼灯
  'BRIGHT': '明亮',
  'ANNUNCIATOR LIGHTS': '信号牌灯', // vault B737-EICAS: 信号牌面板 (annunciator panel)
  'STANDBY COMPASS': '备用指南针', // ini-a340 "STBY COMPASS LT" -> 备用指南针灯
  'ICE INDICATOR & SEAT POSITION': '结冰指示器与座椅位置',
  'STBY COMPASS, ICE INDICATOR & SEAT POSITION LIGHTS': '备用指南针、结冰指示器与座椅位置灯',
  'COCKPIT STORM LIGHTS': '驾驶舱暴风雨灯', // ini-a340 "STORM" -> 暴风雨
  'COCKPIT STORM LIGHT FUNCTION': '驾驶舱暴风雨灯功能',
  'OBSERVER CONSOLE LIGHT': '观察员控制台灯',
  'LEFT SIDE READING LIGHT': '左侧阅读灯', // ini-a340 "READING LT" -> 阅读灯
  'RIGHT SIDE READING LIGHT': '右侧阅读灯',
  'CAPTAIN\'S READING LIGHT': '机长阅读灯', // ini-a340 "CPT READING LT KNOB" -> 机长阅读灯旋钮
  'FO\'S READING LIGHT': '副驾驶阅读灯',
  'OVERHEAD READING LIGHT': '顶板阅读灯',
  'PANEL INTEGRAL LIGHTS': '面板整体照明灯',
  'MAIN PANEL FLOOD LIGHTS': '主仪表盘泛光灯', // ini-a340 verbatim
  'PEDESTAL FLOOD LIGHTS': '操纵台泛光灯', // ini-a340 "PEDESTAL FLOOD LIGHT" verbatim
  'COCKPIT AMBIENT LIGHTS': '驾驶舱环境灯', // 待实机确认

  // --- ECAM control panel / surveillance
  'ABNORMAL PROCEDURES MENU': '非正常程序菜单',
  'NORMAL CHECKLIST MENU': '正常检查单菜单',
  'CHECKLIST MENU SHORTCUT': '检查单菜单快捷键',
  'CHECKLIST TICK SHORTCUT': '检查单勾选快捷键', // 待实机确认
  'TICK BUTTON': '勾选按钮', // 待实机确认
  'CYCLE THROUGH ALL SD PAGES': '循环切换全部系统显示页',
  'APU SD PAGE': 'APU系统显示页',
  'BLEED SD PAGE': '引气系统显示页',
  'CIRCUIT BREAKER SD PAGE': '跳开关系统显示页',
  'AIR CONDITIONING SD PAGE': '空调系统显示页',
  'DOOR SD PAGE': '舱门系统显示页',
  'ELECTRIC AC PAGE': '交流电气页',
  'ELECTRIC DC PAGE': '直流电气页',
  'ENGINE SD PAGE': '发动机系统显示页',
  'E/WD BRIGHTNESS': '发动机/警告显示亮度',
  'FLIGHT CONTROLS SD PAGE': '飞行操纵系统显示页', // gen-ini A340 table: FLT CTL … -> 飞行操纵…
  'FUEL SD PAGE': '燃油系统显示页',
  'HYDRAULICS SD PAGE': '液压系统显示页',
  'SD MORE': '系统显示更多',
  'PRESSURIZATION SD PAGE': '增压系统显示页',
  'RECALL BUTTON': '调回按钮',
  'RECALL LAST': '调回上一页', // 待实机确认
  'SD BRIGHTNESS': '系统显示亮度',
  'STATUS': '状态',
  'TAKEOFF CONFIGURATION TEST': '起飞构型测试',
  'VIDEO SD PAGE': '视频系统显示页', // 待实机确认 — A380 cabin video page on the SD
  'WHEEL SD PAGE': '起落架系统显示页', // 待实机确认 — WHEEL page = brakes/gear
  'CLEAR BUTTON': '清除按钮',
  'TOOLTPRESS TO REMOVE EWD/SD LINEIP': '按下以清除显示行', // vendor typo, same string as PRESS TO REMOVE EWD/SD LINE
  'ACMS EVENT TRIGGER': 'ACMS事件触发',
  'DFDR EVENT TRIGGER': '数字飞行数据记录器事件触发', // ini-a340 "DFDR EVENT" -> 数字飞行数据记录器事件
  'TCAS ABOVE DISPLAY': 'TCAS上方显示', // 待实机确认 — ADIU surveillance range selector
  'TCAS BELOW DISPLAY': 'TCAS下方显示', // 待实机确认
  'TCAS TA ONLY': 'TCAS仅交通通告',
  'GLIDE SLOPE MODE OFF': '下滑道模式关闭',
  'TAWS GLIDE SLOPE MODE GUARD': '地形告警下滑道模式保护',
  'TRANSPONDER SYSTEM 1': '应答机系统1', // vault 空客-通信: 应答机
  'TRANSPONDER SYSTEM 2': '应答机系统2',
  'WEATHER RADAR SYSTEM 1': '气象雷达系统1',
  'WEATHER RADAR SYSTEM 2': '气象雷达系统2',
  'WEATHER RADAR AZIMUTH': '气象雷达方位',
  'WEATHER RADAR ELEVATION': '气象雷达仰角', // 待实机确认
  'WEATHER RADAR GAIN': '气象雷达增益', // 待实机确认
  'SELECT MANUAL VD AZIM MODE': '选择人工方位模式', // knob PULL action of WEATHER RADAR AZIMUTH — 待实机确认
  'SELECT AUTO VD AZIM MODE': '选择自动方位模式', // 待实机确认
  'SELECT MANUAL ELEVN MODE': '选择人工仰角模式', // 待实机确认
  'SELECT AUTO ELEVN MODE': '选择自动仰角模式', // 待实机确认
  'SELECT MANUAL GAIN MODE': '选择人工增益模式', // 待实机确认
  'SELECT AUTO GAIN MODE': '选择自动增益模式', // 待实机确认

  // --- oxygen
  'COCKPIT OXYGEN SUPPLY': '驾驶舱氧气供应', // fs-base "Oxygen crew supply" -> 机组氧气供应
  'PASSENGER OXYGEN MASKS MANUAL RELEASE': '旅客氧气面罩人工释放',
  'OXYGEN MASKS MANUAL RELEASE GUARD': '氧气面罩人工释放保护',
  'EMERGENCY PRESSURE SELECTOR': '应急压力选择器',
  'OXYGEN PRESS TO TEST/RESET': '按下以测试/重置氧气',
  'NORMAL/100% SELECTOR': '正常/100%选择器', // ini-a340 "OXY MASK 100% TEST" -> 氧气面罩100%测试

  // --- RMP / audio panel
  'LINE SELECT': '行选键', // vault 空客-MCDU: 行选键 (fs-base renders this 航线选择按键, wrong here)
  'BRIGHTNESS/POWER KNOB': '亮度/电源旋钮',
  'MICROPHONE SELECTOR': '麦克风选择器',
  'VOLUME CONTROL': '音量控制',
  'HEADSET MICROPHONE SELECTOR': '耳机麦克风选择器',
  'INTERPHONE': '内话', // vault 空客-通信: 服务内话
  'TRANSMIT': '发射',
  'HF PAGE': 'HF页',
  'VHF PAGE': 'VHF页',
  'TEL PAGE': '电话页', // 待实机确认 — SATCOM telephone page
  'SQUAWK PAGE': '应答机代码页', // vault 空客-通信: SQUAWK 四位数代码
  'MENU PAGE': '菜单页',
  'NAVIGATION PAGE': '导航页',
  'CLEAR MESSAGE': '清除报文',
  'PERIOD': '句号键', // fs-base "Press PERIOD (.)" -> 按句号键(.)
  'FILTER MORSE FROM VOICE': '从语音中过滤莫尔斯码', // vault 翼胜RMP面板: HF 莫尔斯码识别
  'STANDBY NAV MODE': '备用导航模式', // vault 空客-RMP: RMP 是导航调谐的备份
  'STANDBY NAV MODE GUARD': '备用导航模式保护',
  'ADF 1': 'ADF 1', // receiver legends, kept verbatim like gen-ini's IR1 / CMC 1 / ATSU 1
  'ADF 2': 'ADF 2',
  'VOR 1': 'VOR 1',
  'VOR 2': 'VOR 2',
  'MARKER': '指点标', // vault 空客-导航系统: MARKER -> 指点标接收
  'IDENT SELECTOR KNOB': '识别选择旋钮', // ini-a340 "IDENT" -> 识别

  // --- windows / windscreen
  'WINDOW SHADE': '遮光板', // 待实机确认
  'WINDOW BLIND': '窗百叶', // ini-a340 "SIDE BLIND" -> 侧百叶
  'WAYLIGHT SWITCH': '通道应急灯电门', // 待实机确认
  'WAYLIGHT': '通道应急灯', // 待实机确认
  'LEFT WINDOW OPEN HANDLE': '左窗开启把手', // 待实机确认
  'RIGHT WINDOW OPEN HANDLE': '右窗开启把手', // 待实机确认
  'CAPTAIN\'S WIPER': '机长雨刷', // fs-base "Windshield WIPER selectors" -> 挡风玻璃雨刷选择器
  'FO\'S WIPER': '副驾驶雨刷',
};

/* =========================================================================
 * 3. Indexed families — the A380 has four engines and FEED/TRIM/INNER/OUTER tank
 *    groups. `#` is replaced by every index in the list, on both sides, so the
 *    Chinese keeps iniBuilds' no-space-before-digit style (发电机1, 发动机3消防).
 * ========================================================================= */
const D4 = [1, 2, 3, 4];
const D3 = [1, 2, 3];
const FAMILIES = [
  // air conditioning
  ['ENGINE # BLEED', '发动机#引气', D4], // ini-a340 "ENG1 BLEED" -> 发动机1引气
  ['ENGINE # ANTI ICE', '发动机#防冰', D4], // ini-a340 "ENG1 ICE" -> 发动机1防冰
  // electrical
  ['ENGINE # DRIVE', '发动机#驱动', D4],
  ['ENGINE # GENERATOR DRIVE DISCONNECT GUARD', '发动机#发电机驱动断开保护', D4],
  ['EXTERNAL POWER #', '外部电源#', D4], // fs-base "External power" -> 外部电源
  ['ENGINE # GENERATOR', '发动机#发电机', D4],
  ['BATTERY #', '电池#', [1, 2]],
  // engines / starting
  ['ENGINE # MANUAL START', '发动机#人工起动', D4], // gen-ini A340/A350 table: MAN START 3 -> 人工起动3
  ['ENGINE # MANUAL START GUARD', '发动机#人工起动保护', D4],
  ['ENGINE # FADEC GROUND POWER', '发动机#FADEC地面电源', D4],
  ['ENGINE # FADEC GROUND POWER GUARD', '发动机#FADEC地面电源保护', D4],
  // fire
  ['ENGINE # FIRE EXTINGUISHER BOTTLE #', '发动机#灭火瓶#', D4],
  ['ENGINE # FIRE BUTTON', '发动机#消防电门', D4], // ini-a340 "ENG1 FIRE" -> 发动机1消防
  ['ENGINE # FIRE BUTTON GUARD', '发动机#消防电门保护', D4],
  // fuel pumps (FEED TANK wording = own published A380 EFB patch: 供油主泵 / 供油备用泵)
  ['FEED TANK # MAIN FUEL PUMP', '供油箱#主燃油泵', D4],
  ['FEED TANK # STANDBY FUEL PUMP', '供油箱#备用燃油泵', D4],
  ['PRIM #', '主计算机#', D3], // gen-ini A340/A350 table: FLT CTL PRIM1 GUARD -> 飞行操纵主计算机1保护
  ['PRIM # GUARD', '主计算机#保护', D3],
  ['SEC #', '扰流板计算机#', D3], // gen-ini A340/A350 table: FLT CTL SEC 1 GUARD -> 飞行操纵扰流板计算机1保护
  ['SEC # GUARD', '扰流板计算机#保护', D3],
  ['ADIRS #', '大气数据惯性基准系统#', D3], // ini-a340 "ADIRS2 IR MODE" -> 大气数据惯性基准系统2惯性基准模式
  ['ADR #', 'ADR #', D3], // panel legends kept verbatim (dict-engine: ADR/IR are the ADIRS knob legends)
  ['IR #', 'IR #', D3],
  // hydraulics
  ['ENGINE # HYDRAULIC PUMP A', '发动机#液压泵A', D4], // ini-a340 "ENGINE 1 GREEN HYD PUMP GUARD" -> 发动机1绿色液压泵保护
  ['ENGINE # HYDRAULIC PUMP B', '发动机#液压泵B', D4],
  ['ENGINE # HYDRAULIC PUMP A+B DISCONNECT', '发动机#液压泵A+B断开', D4],
  // autopilot / thrust levers / masters
  ['AUTOPILOT #', '自动驾驶#', [1, 2]],
  ['ENGINE MASTER #', '发动机主电门#', D4], // rules-common: left engine master -> 左发主电门
  ['ENGINE # THRUST LEVER', '发动机#推力手柄', D4], // 待实机确认 — no termbase/vault hit for THRUST LEVER
  ['THRUST LEVER #', '推力手柄#', D4], // 待实机确认 — 推力手柄 has no termbase/vault hit either
];

/** Two-sided families written as an explicit left/right pair (Chinese order differs). */
const PAIRS = [
  ['LEFT INNER TANK AFT FUEL PUMP', 'RIGHT INNER TANK AFT FUEL PUMP', '左内侧油箱后燃油泵', '右内侧油箱后燃油泵'],
  ['LEFT MIDDLE TANK AFT FUEL PUMP', 'RIGHT MIDDLE TANK AFT FUEL PUMP', '左中部油箱后燃油泵', '右中部油箱后燃油泵'],
  ['LEFT INNER TANK FORWARD FUEL PUMP', 'RIGHT INNER TANK FORWARD FUEL PUMP', '左内侧油箱前燃油泵', '右内侧油箱前燃油泵'],
  ['LEFT MIDDLE TANK FORWARD FUEL PUMP', 'RIGHT MIDDLE TANK FORWARD FUEL PUMP', '左中部油箱前燃油泵', '右中部油箱前燃油泵'],
  ['LEFT OUTER TANK FUEL PUMP', 'RIGHT OUTER TANK FUEL PUMP', '左外侧油箱燃油泵', '右外侧油箱燃油泵'], // own A380 EFB patch: OUTR LEFT TANK -> 左外侧油箱
  ['TRIM TANK LEFT FUEL PUMP', 'TRIM TANK RIGHT FUEL PUMP', '配平油箱左燃油泵', '配平油箱右燃油泵'],
];

/* =========================================================================
 * 4. Keyboard / MCDU keycap legends. There is no Chinese form for a letter key,
 *    so the legend is kept (same decision gen-ini already makes for 1-9, IR1-3
 *    and KEEP's ADK 1). The engine's `out === en` guard is bypassed with one
 *    trailing space, which `norm()` strips back off.
 * ========================================================================= */
const KEYCAPS = Object.fromEntries(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '0'].map((c) => [c, c]),
);

export const EXACT = {
  ...ACTIONS,
  ...LABELS,
  ...KEYCAPS,
};

/** Fill every `#` slot with the index list (one slot, or two for bottle-per-engine). */
const expand = (en, zh, digits, out = EXACT) => {
  const at = en.indexOf('#');
  if (at < 0) {
    out[en] = zh;
    return;
  }
  for (const d of digits) {
    expand(en.replace('#', String(d)), zh.replace('#', String(d)), digits, out);
  }
};
for (const [en, zh, digits] of FAMILIES) expand(en, zh, digits);
for (const [enL, enR, zhL, zhR] of PAIRS) {
  EXACT[enL] = zhL;
  EXACT[enR] = zhR;
}

const LOOKUP = new Map(Object.entries(EXACT).map(([k, v]) => [norm(k), v]));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EXACT_ALT = new RegExp(
  '^(?:' + [...LOOKUP.keys()].sort((a, b) => b.length - a.length).map(esc).join('|') + ')$',
);

/**
 * Fallback frames for the two shapes gen-ini's own frames cannot finish because the
 * inner label only exists in this table: `<label> GUARD` and `SET <label>`.
 */
const zhOf = (label) => EXACT[norm(label)] ?? loadTermbase().get(norm(label)) ?? null;

export const PATTERNS = [
  // the authored table itself, matched first so it beats every shared frame
  [EXACT_ALT, (m, full) => {
    const zh = LOOKUP.get(full);
    if (!zh) return null;
    // keycap legends map to themselves; one trailing space gets the value past the
    // engine's `out === en` guard and `norm()` strips it again
    return zh === full ? zh + ' ' : zh;
  }],
  [/^(.+?) GUARD$/, (m) => {
    const zh = zhOf(m[1]);
    return zh && zh !== m[1] ? zh + '保护' : null;
  }],
  [/^SET (.+)$/, (m) => {
    const zh = zhOf(m[1]);
    return zh && zh !== m[1] ? '设置' + zh : null;
  }],
];
