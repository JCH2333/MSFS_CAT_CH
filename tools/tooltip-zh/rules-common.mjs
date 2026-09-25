/**
 * Shared English->Chinese frames for cockpit hover tooltips (all aircraft).
 *
 * House style, taken from the already-published sibling dictionaries and the user's own
 * aviation notes rather than invented here:
 *   - ubiquitous system abbreviations stay BARE: APU / IDG / RAT / PTU / ELAC / SEC / FAC /
 *     FADEC / TCAS / CVR / GPWS / EGPWS / ECAM / MCDU / FMGC / ADIRU ...
 *     (precedent: `dict-precedent.mjs` shows APU/IDG/RAT/CVR/TCAS/FADEC all 保留不译;
 *      the Obsidian vault writes 「双向 PTU 与应急 RAT」「近地警告 EGPWS」 bare too)
 *   - genuinely obscure abbreviations get a bracketed gloss ONCE, at the subject:
 *     ADIRS（大气惯导）  [precedent: fenix-zh-dict.js]
 *   - length budget: a tooltip bubble is narrow, so the target is <= 14 Chinese chars for
 *     labels and <= 20 for action lines; the engine flags anything over 46.
 *
 * Verb frames follow the switch class, not the English verb, because 中文 says
 * 接通电源 / 打开灯 / 打开活门 / 展开襟翼 and never one uniform verb.
 */

/** Strings that must never be translated (behaviour-judging tokens, type names, brands). */
export const PRESERVE = [
  'ON', 'OFF', 'AUTO', 'MAN', 'MANUAL', 'NORM', 'NORMAL', 'SHUT', 'OPEN', 'CLOSE', 'ARM', 'ARMED',
  'TOGA', 'MCT', 'CLB', 'CRZ', 'DES', 'APP', 'ALT CPT', 'V1', 'VR', 'V2', 'MTOW', 'MZFW', 'ZFW',
  'ECAM', 'E/WD', 'SD', 'ND', 'PFD', 'MCDU', 'FCU', 'EFIS', 'APU', 'IDG', 'PTU', 'RAT', 'FADEC',
  'VOR', 'ADF', 'ILS', 'MLS', 'GLS', 'GPS', 'RNAV', 'IR', 'ADR', 'ADIRS', 'ADIRU', 'DMC', 'EIS',
  'TCAS', 'GPWS', 'EGPWS', 'TA', 'RA', 'TA/RA', 'STBY', 'CVR', 'FDR', 'DFDR', 'ELT', 'SATCOM',
  'HF', 'VHF', 'PA', 'CA', 'ATSU', 'ACARS', 'CPDLC', 'ATIS', 'AM', 'FM', 'AIR', 'GPU', 'EXT PWR',
  'EMER CANC', 'RST', 'CLR', 'ENT', 'DEL', 'BRT', 'DIM', 'TILT', 'GND', 'WX', 'RAD', 'BARO',
  'STD', 'HDG', 'TRK', 'FPA', 'VS', 'SPD', 'MACH', 'FL', 'ALT', 'L', 'R', 'C', 'X-BLEED',
];

/** Subject classes drive which Chinese verb pair the frames below pick. */
export const CLASS_VERBS = {
  pwr: ['接通', '断开'],        // electrical supply, system power, computers
  air: ['接通', '关断'],        // bleed / anti-ice / pressurisation supplies
  light: ['打开', '关闭'],      // any lamp, light, sign
  valve: ['打开', '关闭'],      // valves, cocks
  door: ['打开', '关闭'],       // doors, panels, hatches, covers
  mode: ['启用', '停用'],       // modes, protections, warnings
  mech: ['放出', '收回'],       // mechanical deployment (RAT, flaps, gear, slides)
  dflt: ['开启', '关闭'],
};

/** Generic control-surface nouns shared across aircraft (vendor-independent). */
export const SUBJECTS = {
  // --- electrical
  'battery 1': { zh: '电池 1', cls: 'pwr' },
  'battery 2': { zh: '电池 2', cls: 'pwr' },
  'generator 1': { zh: '发电机 1', cls: 'pwr' },
  'generator 2': { zh: '发电机 2', cls: 'pwr' },
  'generator 1 line': { zh: '发电机 1 线路', cls: 'pwr' },
  'generator 2 line': { zh: '发电机 2 线路', cls: 'pwr' },
  'external power': { zh: '外部电源', cls: 'pwr' },
  'maintenance bus': { zh: '维护汇流条', cls: 'pwr' },
  'bus tie': { zh: '汇流条连接', cls: 'pwr' },
  'ac essential feed bus source': { zh: '交流重要汇流条电源', cls: 'pwr' },
  'commercial electrical loads': { zh: '商用电源负载', cls: 'pwr' },
  'galley and cabin': { zh: '厨房与客舱', cls: 'pwr' },
  'idg 1': { zh: 'IDG 1', cls: 'pwr' },
  'idg 2': { zh: 'IDG 2', cls: 'pwr' },
  'rat': { zh: 'RAT（冲压空气涡轮）', cls: 'pwr' },
  'ptu': { zh: 'PTU', cls: 'pwr' },
  'apu generator': { zh: 'APU 发电机', cls: 'pwr' },
  'apu master': { zh: 'APU 主电门', cls: 'pwr' },
  'apu starter': { zh: 'APU 起动器', cls: 'pwr' },
  'apu bleed': { zh: 'APU 引气', cls: 'air' },
  'gpu': { zh: 'GPU（地面电源）', cls: 'pwr' },
  'fadec 1 ground power': { zh: 'FADEC 1 地面电源', cls: 'pwr' },
  'fadec 2 ground power': { zh: 'FADEC 2 地面电源', cls: 'pwr' },
  'elac 1': { zh: 'ELAC 1', cls: 'pwr' },
  'elac 2': { zh: 'ELAC 2', cls: 'pwr' },
  'sec 1': { zh: 'SEC 1', cls: 'pwr' },
  'sec 2': { zh: 'SEC 2', cls: 'pwr' },
  'sec 3': { zh: 'SEC 3', cls: 'pwr' },
  'fac 1': { zh: 'FAC 1', cls: 'pwr' },
  'fac 2': { zh: 'FAC 2', cls: 'pwr' },
  'yaw damper': { zh: '偏航阻尼器', cls: 'pwr' },
  // --- hydraulics / fuel
  'blue electrical pump': { zh: '蓝系统电动泵', cls: 'pwr' },
  'yellow electrical pump': { zh: '黄系统电动泵', cls: 'pwr' },
  'blue pump override': { zh: '蓝系统电动泵超控', cls: 'pwr' },
  'blue leak measurement valve': { zh: '蓝系统渗漏测量活门', cls: 'valve' },
  'green leak measurement valve': { zh: '绿系统渗漏测量活门', cls: 'valve' },
  'yellow leak measurement valve': { zh: '黄系统渗漏测量活门', cls: 'valve' },
  'left engine hydraulic pump': { zh: '左发液压泵', cls: 'pwr' },
  'right engine hydraulic pump': { zh: '右发液压泵', cls: 'pwr' },
  'fuel cross feed': { zh: '燃油交输', cls: 'valve' },
  'center fuel tank pump 1': { zh: '中央油箱泵 1', cls: 'pwr' },
  'center fuel tank pump 2': { zh: '中央油箱泵 2', cls: 'pwr' },
  'left wing fuel tank pump 1': { zh: '左翼油箱泵 1', cls: 'pwr' },
  'left wing fuel tank pump 2': { zh: '左翼油箱泵 2', cls: 'pwr' },
  'right wing fuel tank pump 1': { zh: '右翼油箱泵 1', cls: 'pwr' },
  'right wing fuel tank pump 2': { zh: '右翼油箱泵 2', cls: 'pwr' },
  'center fuel tank control': { zh: '中央油箱泵控制', cls: 'dflt' },
  'pack 1': { zh: '组件 1', cls: 'pwr' },
  'pack 2': { zh: '组件 2', cls: 'pwr' },
  'econ flow': { zh: '经济流量', cls: 'mode' },
  'blower': { zh: '鼓风机', cls: 'pwr' },
  'cabin recirculation fans': { zh: '客舱再循环风扇', cls: 'pwr' },
  'extract vent fan': { zh: '排出风扇', cls: 'pwr' },
  'hot air': { zh: '热空气', cls: 'valve' },
  'ram air': { zh: '冲压空气', cls: 'valve' },
  'cabin pressurization': { zh: '客舱增压', cls: 'dflt' },
  // --- anti-ice / detection
  'left engine anti-ice': { zh: '左发防冰', cls: 'air' },
  'right engine anti-ice': { zh: '右发防冰', cls: 'air' },
  'wing anti-ice': { zh: '机翼防冰', cls: 'air' },
  'probe/window heat': { zh: '探头/风挡加温', cls: 'pwr' },
  'left engine bleed': { zh: '左发引气', cls: 'air' },
  'right engine bleed': { zh: '右发引气', cls: 'air' },
  'ditching': { zh: '水上迫降', cls: 'mode' },
  'ice indicator & standby compass integral lighting': { zh: '结冰指示器与备用罗盘整体照明', cls: 'light' },
  // --- engines / starting
  'engine 1 n1 mode': { zh: '1 号发动机 N1 方式', cls: 'mode' },
  'engine 2 n1 mode': { zh: '2 号发动机 N1 方式', cls: 'mode' },
  'manual engine 1 start': { zh: '1 号发动机人工起动', cls: 'mode' },
  'manual engine 2 start': { zh: '2 号发动机人工起动', cls: 'mode' },
  'left engine master': { zh: '左发主电门', cls: 'pwr' },
  'right engine master': { zh: '右发主电门', cls: 'pwr' },
  'left throttle': { zh: '左油门杆', cls: 'dflt' },
  'right throttle': { zh: '右油门杆', cls: 'dflt' },
  'brake fan': { zh: '刹车风扇', cls: 'pwr' },
  // --- warnings / protection
  'gpws': { zh: 'GPWS（近地警告系统）', cls: 'pwr' },
  'egpws': { zh: 'EGPWS（增强型近地警告）', cls: 'pwr' },
  'flap gpws warning': { zh: '襟翼近地警告', cls: 'mode' },
  'glideslope gpws warning': { zh: '下滑道近地警告', cls: 'mode' },
  'rad alt': { zh: '无线电高度', cls: 'dflt' },
  'seat belt signs': { zh: '系好安全带信号灯', cls: 'light' },
  'no smoking signs': { zh: '禁止吸烟信号灯', cls: 'light' },
  'emergency call': { cls: 'mode', zh: '紧急呼叫' },
  'evacuation command': { zh: '撤离指令', cls: 'mode' },
  'evacuation horn': { zh: '撤离喇叭', cls: 'dflt' },
  'transponder altitude reporting': { zh: '应答机高度报告', cls: 'mode' },
  'anti-skid and nose wheel steering': { zh: '防滑与前轮转弯', cls: 'mode' },
  'rudder lockout': { zh: '方向舵锁定位', cls: 'mode' },
  'flap 3 landing mode': { zh: '襟翼 3 落地方式', cls: 'mode' },
  'high altitude landing': { zh: '高原着陆', cls: 'mode' },
  'autoland warning': { zh: '盲降自动着陆警告', cls: 'dflt' },
  // vault 空客-自动飞行.md / B737-EICAS.md: 红色 MASTER WARNING=主警告, 琥珀色 MASTER CAUTION=主警戒
  'master caution': { zh: '主警戒', cls: 'dflt' },
  'master warning': { zh: '主警告', cls: 'dflt' },
  'ecam emergency message': { zh: 'ECAM 紧急信息', cls: 'dflt' },
  'ecam message': { zh: 'ECAM 信息', cls: 'dflt' },
  'atc reminder': { zh: 'ATC 提醒', cls: 'dflt' },
  // --- fire
  'left engine fire button': { zh: '左发灭火电门', cls: 'door' },
  'right engine fire button': { zh: '右发灭火电门', cls: 'door' },
  'apu fire button': { zh: 'APU 灭火电门', cls: 'door' },
  'left engine fire extinguisher system': { zh: '左发灭火系统', cls: 'mode' },
  'right engine fire extinguisher system': { zh: '右发灭火系统', cls: 'mode' },
  'apu fire extinguisher system': { zh: 'APU 灭火系统', cls: 'mode' },
  'forward cargo fire switch': { zh: '前货舱灭火电门', cls: 'door' },
  'aft cargo fire switch': { zh: '后货舱灭火电门', cls: 'door' },
  'cargo smoke fire detection/extinguishing system': { zh: '货舱烟雾探测/灭火系统', cls: 'dflt' },
  'left engine fire detection/extinguishing system': { zh: '左发烟雾探测/灭火系统', cls: 'dflt' },
  'right engine fire detection/extinguishing system': { zh: '右发烟雾探测/灭火系统', cls: 'dflt' },
  'apu fire detection/extinguishing system': { zh: 'APU 烟雾探测/灭火系统', cls: 'dflt' },
  // --- lights
  'beacon lights': { zh: '信标灯', cls: 'light' },
  'navigation lights': { zh: '航行灯', cls: 'light' },
  'landing lights': { zh: '着陆灯', cls: 'light' },
  'left landing light': { zh: '左着陆灯', cls: 'light' },
  'right landing light': { zh: '右着陆灯', cls: 'light' },
  'strobe lights': { zh: '频闪灯', cls: 'light' },
  'wing lights': { zh: '机翼灯', cls: 'light' },
  'runway turn off lights': { zh: '跑道脱离灯', cls: 'light' },
  'nose light': { zh: '机头灯', cls: 'light' },
  'chart light': { zh: '航图灯', cls: 'light' },
  'dome light': { zh: '漫射顶灯', cls: 'light' },
  'reading light': { zh: '阅读灯', cls: 'light' },
  'loading area light': { zh: '装载区灯', cls: 'light' },
  'forward cargo light': { zh: '前货舱灯', cls: 'light' },
  'aft cargo light': { zh: '后货舱灯', cls: 'light' },
  'cargo door open annunciator': { zh: '货舱门打开指示灯', cls: 'light' },
  'annunciators': { zh: '指示灯', cls: 'light' },
  'emergency exit light': { zh: '应急出口灯', cls: 'light' },
  'avionics compartment light': { zh: '电子设备舱灯', cls: 'light' },
  'captain map light': { zh: '机长地图灯', cls: 'light' },
  'f/o map light': { zh: '副驾驶地图灯', cls: 'light' },
  'console/floor light': { zh: '中央操纵台/地板灯', cls: 'light' },
  // --- doors / panels / covers
  'cockpit door': { zh: '驾驶舱门', cls: 'door' },
  'cockpit door video': { zh: '驾驶舱门视频', cls: 'pwr' },
  'cockpit door lock': { zh: '驾驶舱门锁', cls: 'door' },
  'bulk cargo door': { zh: '散装货舱门', cls: 'door' },
  'forward cargo door': { zh: '前货舱门', cls: 'door' },
  'aft cargo door': { zh: '后货舱门', cls: 'door' },
  'left main gear door': { zh: '左主起落架舱门', cls: 'door' },
  'right main gear door': { zh: '右主起落架舱门', cls: 'door' },
  'nose gear doors': { zh: '前起落架舱门', cls: 'door' },
  'fuel panel': { zh: '加油面板', cls: 'door' },
  'gpu panel': { zh: '地面电源面板', cls: 'door' },
  'hydraulic access panel': { zh: '液压接近面板', cls: 'door' },
  'oxygen mask cover': { zh: '氧气面罩盖', cls: 'door' },
  'cctv': { zh: 'CCTV（舱门监控）', cls: 'door' },
  'standby compass': { zh: '备用罗盘', cls: 'mech' },
  // --- refuel valves
  'act 1 refuel valve': { zh: 'ACT 1 加油活门', cls: 'valve' },
  'act 2 refuel valve': { zh: 'ACT 2 加油活门', cls: 'valve' },
  'center refuel valve': { zh: '中央油箱加油活门', cls: 'valve' },
  'left refuel valve': { zh: '左翼加油活门', cls: 'valve' },
  'right refuel valve': { zh: '右翼加油活门', cls: 'valve' },
  'mode select': { zh: '方式选择', cls: 'valve' },
  'aft cargo ventilation': { zh: '后货舱通风', cls: 'air' },
  // --- radios / audio
  'vhf1': { zh: 'VHF1', cls: 'dflt' },
  'vhf2': { zh: 'VHF2', cls: 'dflt' },
  'vhf3': { zh: 'VHF3', cls: 'dflt' },
  'hf1': { zh: 'HF1', cls: 'dflt' },
  'hf2': { zh: 'HF2', cls: 'dflt' },
  'adf1': { zh: 'ADF1', cls: 'dflt' },
  'adf2': { zh: 'ADF2', cls: 'dflt' },
  'vor1': { zh: 'VOR1', cls: 'dflt' },
  'vor2': { zh: 'VOR2', cls: 'dflt' },
  'ils': { zh: 'ILS', cls: 'dflt' },
  'mkr': { zh: 'MKR（指点标）', cls: 'dflt' },
  'mls': { zh: 'MLS（微波着陆系统）', cls: 'dflt' },
  'gls': { zh: 'GLS（GBAS 着陆系统）', cls: 'dflt' },
  'pa': { zh: 'PA（客舱广播）', cls: 'dflt' },
  'bfo': { zh: 'BFO（备用振荡器）', cls: 'dflt' },
  'cabin interphone': { zh: '客舱内话', cls: 'dflt' },
  'flight interphone': { zh: '机组内话', cls: 'dflt' },
  'radio management panel': { zh: 'RMP（无线电管理面板）', cls: 'pwr' },
  'loud speaker volume': { zh: '扬声器音量', cls: 'dflt' },
  'interphone': { zh: '内话', cls: 'dflt' },
  'voice': { zh: 'VOICE（语音）', cls: 'dflt' },
  'data': { zh: 'DATA（数据）', cls: 'dflt' },
  'ident': { zh: 'IDENT（识别码）', cls: 'dflt' },
  'cvr': { zh: 'CVR（驾驶舱语音记录器）', cls: 'dflt' },
  'elt': { zh: 'ELT（应急定位发射机）', cls: 'dflt' },
  'transponder': { zh: '应答机', cls: 'dflt' },
  'weather radar': { zh: '气象雷达', cls: 'dflt' },
  // --- displays / selectors
  'nd': { zh: 'ND', cls: 'dflt' },
  'pfd': { zh: 'PFD', cls: 'dflt' },
  'ecam': { zh: 'ECAM', cls: 'dflt' },
  'efb': { zh: 'EFB（电子飞行包）', cls: 'dflt' },
  'selected frequency': { zh: '选定频率', cls: 'dflt' },
  'selected altitude': { zh: '选定高度', cls: 'dflt' },
  'selected speed': { zh: '选定速度', cls: 'dflt' },
  'selected heading': { zh: '选定航向', cls: 'dflt' },
  'selected baro': { zh: '选定气压基准', cls: 'dflt' },
  'selected standby baro': { zh: '选定备用气压基准', cls: 'dflt' },
  'standby baro': { zh: '备用气压基准', cls: 'dflt' },
  'vertical speed': { zh: '垂直速度', cls: 'dflt' },
  'altitude selector': { zh: '高度选择窗', cls: 'dflt' },
  'heading selector': { zh: '航向选择窗', cls: 'dflt' },
  'speed selector': { zh: '速度选择窗', cls: 'dflt' },
  'baro selector': { zh: '气压基准选择窗', cls: 'dflt' },
  'standby bug': { zh: '备用速度基准游标', cls: 'dflt' },
  'bugs': { zh: '速度基准游标', cls: 'dflt' },
  'rudder trim': { zh: '方向舵配平', cls: 'dflt' },
  'landing elevation': { zh: '着陆标高', cls: 'dflt' },
  'date': { zh: '日期', cls: 'dflt' },
  'time': { zh: '时间', cls: 'dflt' },
  'internal time and date': { zh: '内部时间与日期', cls: 'dflt' },
  'gps time and date': { zh: 'GPS 时间与日期', cls: 'dflt' },
  'chronometer': { zh: '计时器', cls: 'dflt' },
  'elapsed time counter': { zh: '经过时间计数器', cls: 'dflt' },
  'brightness': { zh: '亮度', cls: 'dflt' },
  // --- autopilot / fcu modes
  'autopilot 1': { zh: '自动驾驶 1', cls: 'pwr' },
  'autopilot 2': { zh: '自动驾驶 2', cls: 'pwr' },
  'autothrottle': { zh: '自动推力', cls: 'pwr' },
  'approach mode': { zh: '进近方式', cls: 'mode' },
  'localizer mode': { zh: 'LOC（航道截获）方式', cls: 'mode' },
  'expedite mode': { zh: ' Expedite（加速爬升/下降）方式', cls: 'mode' },
  'level off mode': { zh: '改平方式', cls: 'mode' },
  'managed heading': { zh: '管理航向', cls: 'mode' },
  'selected heading': { zh: '选定航向', cls: 'mode' },
  'managed speed': { zh: '管理速度', cls: 'mode' },
  'managed level change': { zh: '管理高度层改变', cls: 'mode' },
  'open level change': { zh: '开放高度层改变', cls: 'mode' },
  'vs mode': { zh: 'VS（垂直速度）方式', cls: 'mode' },
  'standard baro': { zh: '标准气压基准', cls: 'dflt' },
  // --- seats / window / misc cabin
  'window': { zh: '侧窗', cls: 'door' },
  'window shade': { zh: '遮阳板', cls: 'dflt' },
  'sun shade': { zh: '遮阳帘', cls: 'dflt' },
  'armrest': { zh: '扶手', cls: 'dflt' },
  'jumpseat headrest': { zh: '折叠座椅头靠', cls: 'dflt' },
  'jumpseat': { zh: '折叠座椅', cls: 'dflt' },
  'tray table': { zh: '小桌板', cls: 'dflt' },
  'captain\u2019s seat': { zh: '机长座椅', cls: 'dflt' },
  "captain's seat": { zh: '机长座椅', cls: 'dflt' },
  'f/o\u2019s seat': { zh: '副驾驶座椅', cls: 'dflt' },
  "f/o's seat": { zh: '副驾驶座椅', cls: 'dflt' },
  'windshield wiper': { zh: '风挡雨刷', cls: 'dflt' },
  'left windshield wiper': { zh: '左风挡雨刷', cls: 'dflt' },
  'right windshield wiper': { zh: '右风挡雨刷', cls: 'dflt' },
  'rain repellent': { zh: '排雨剂', cls: 'dflt' },
  'emergency slide': { zh: '应急滑梯', cls: 'mech' },
  'wheel chock': { zh: '轮挡', cls: 'dflt' },
  'parking brake': { zh: '停机刹车', cls: 'dflt' },
  'gust lock': { zh: '风锁', cls: 'dflt' },
  'emergency gear handle': { zh: '应急放起落架手柄', cls: 'dflt' },
  'landing gear': { zh: '起落架', cls: 'mech' },
  'fan blades': { zh: '风扇叶片', cls: 'dflt' },
  'artificial horizon': { zh: '人工地平仪', cls: 'dflt' },
  'oxygen mask': { zh: '氧气面罩', cls: 'dflt' },
  'crew oxygen supply': { zh: '机组供氧', cls: 'air' },
  'oxygen tmr': { zh: '氧气定时器', cls: 'dflt' },
  'refuel amount': { zh: '加油量', cls: 'dflt' },
  'aircraft config for takeoff': { zh: '起飞构型', cls: 'dflt' },
  'autobrake': { zh: '自动刹车', cls: 'dflt' },
  'door control handle': { zh: '舱门控制手柄', cls: 'dflt' },
  'cargo door manual selector valve': { zh: '货舱门人工选择活门', cls: 'valve' },
  'cargo door selector panel': { zh: '货舱门选择面板', cls: 'door' },
  'cargo door handle': { zh: '货舱门手柄', cls: 'dflt' },
  'bulk cargo door handle': { zh: '散装货舱门手柄', cls: 'dflt' },
  'front cargo door handle': { zh: '前货舱门手柄', cls: 'dflt' },
  'rear cargo door handle': { zh: '后货舱门手柄', cls: 'dflt' },
  'cage': { zh: '解除姿态仪旗标', cls: 'dflt' },
  'spoilers': { zh: '扰流板', cls: 'mech' },
  'speedbrake': { zh: '减速板', cls: 'mech' },
  'manual elevator trim': { zh: '人工升降舵配平', cls: 'dflt' },
  'navigation & logo lights': { zh: '航行灯与标志灯', cls: 'light' },
  'pack flow': { zh: '组件流量', cls: 'dflt' },
  'emer canc': { zh: 'EMER CANC（紧急取消）', cls: 'dflt' },
  'cargo door': { zh: '货舱门', cls: 'door' },
  'forward cargo door': { zh: '前货舱门', cls: 'door' },
  'aft cargo door': { zh: '后货舱门', cls: 'door' },
  'auto cabin oxygen mask doors': { zh: '客舱氧气面罩舱门自动开启', cls: 'door' },
  'cockpit recorder': { zh: '座舱通话记录器', cls: 'dflt' },
  'altitude selector scale': { zh: '高度窗刻度', cls: 'dflt' },
  'weather radar multiscan': { zh: '气象雷达多扫描', cls: 'dflt' },
  'weather radar pws': { zh: '气象雷达 PWS（预测式风切变）', cls: 'dflt' },
  'transponder atc': { zh: '应答机 ATC 天线', cls: 'dflt' },
  'emergency generator': { zh: '应急发电机', cls: 'pwr' },
  'emergency generator test': { zh: '应急发电机测试', cls: 'dflt' },
  'apu shut off': { zh: 'APU 关断', cls: 'pwr' },
  'baro': { zh: '气压基准', cls: 'dflt' },
  'nav': { zh: 'NAV', cls: 'dflt' },
  'mask manual': { zh: '氧气面罩人工释放', cls: 'door' },
  'battery power': { zh: '电池电源', cls: 'pwr' },
};

/**
 * Ordered frames. Longest / most specific first — the engine stops at the first match,
 * so "Turn off left engine anti-ice" must be tried before any looser "Turn off" shape.
 * `{S}` slots are filled from SUBJECTS (case-insensitive); the frame receives the subject
 * record so it can pick the class-correct verb.
 */
export const CLASS_FRAMES = {
  on: (s) => CLASS_VERBS[s.cls ?? 'dflt'][0],
  off: (s) => CLASS_VERBS[s.cls ?? 'dflt'][1],
};

/** Case-insensitive subject lookup, tolerating a trailing plural the glossary dropped. */
function raw(text) {
  const norm = (s) => String(s).replace(/\s+/g, ' ').replace(/[’‘`]/g, "'").trim().toLowerCase();
  const k = norm(text);
  return SUBJECTS[k] ?? SUBJECTS[k.replace(/s$/, '')] ?? SUBJECTS[`${k}s`] ?? null;
}

/**
 * Trailing device words Fenix appends to a system name ("emergency call button",
 * "blue pump override switch"). Splitting them off lets one glossary entry serve every
 * phrasing, and the Chinese device word is reported back for composition.
 */
const DEVICE = [
  [/\s+pushbutton$/i, '按钮'],
  [/\s+button$/i, '按钮'],
  [/\s+switch$/i, '电门'],
  [/\s+knob$/i, '旋钮'],
  [/\s+selector$/i, '选择器'],
  [/\s+handle$/i, '手柄'],
  [/\s+panel$/i, '面板'],
  [/\s+valve$/i, '活门'],
  [/\s+pump$/i, '泵'],
  [/\s+light$/i, '灯'],
  [/\s+lights$/i, '灯'],
  [/\s+cover$/i, '护罩'],
];

export function subj(text) {
  const direct = raw(text);
  if (direct) return { ...direct, device: null };
  for (const [re, zh] of DEVICE) {
    if (!re.test(text)) continue;
    const stem = text.replace(re, '');
    const hit = raw(stem);
    if (hit) return { ...hit, zh: hit.zh + zh, device: zh };
  }
  return null;
}
