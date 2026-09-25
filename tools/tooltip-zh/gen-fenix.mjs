/**
 * Fenix A320 cockpit-tooltip dictionary generator.
 *
 * Corpus: the vendor's own en-US.locPak — 1,208 keys, 780 distinct English strings,
 * 729 controls. Fenix ships NO Chinese package at all, so this is a from-zero gap.
 *
 * The value text is written as full sentences ("Turn on battery 1"), so the frames below
 * translate the FRAME and look up the SUBJECT, instead of translating word by word.
 * Anything neither the termbase, nor EXACT, nor a frame, nor SUBJECTS can resolve is
 * collected into TODO and the build refuses to invent it.
 *
 *   node tools/tooltip-zh/gen-fenix.mjs [--write] [--show N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { readLocPak, listLocPakFiles, isTooltipKey } from './lib.mjs';
import { compile, loadTermbase } from './dict-engine.mjs';
import { PRESERVE, SUBJECTS, CLASS_VERBS, subj } from './rules-common.mjs';

const PKG = process.env.FENIX_PKG || 'F:/games/community/Community/fnx-aircraft-320';
const OUT = '.local-lab/tooltip/dict-fenix.json';
const WRITE = process.argv.includes('--write');
const SHOW = process.argv.includes('--show') ? +process.argv[argv().indexOf('--show') + 1] : 40;
function argv() {
  return process.argv;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const lower = (s) => norm(s).toLowerCase().replace(/[’‘`]/g, "'");

/** noun -> Chinese for the object position of a frame.
 *  `required` is deliberately ignored: a frame that cannot resolve its subject returns
 *  null and lands in TODO instead of leaking English words into a Chinese sentence. */
function S(text) {
  return subj(text);
}
function on(text) {
  const s = S(text);
  return s ? CLASS_VERBS[s.cls][0] + s.zh : null;
}
function off(text) {
  const s = S(text);
  return s ? CLASS_VERBS[s.cls][1] + s.zh : null;
}

/** Labels that are a whole tooltip on their own. */
const LABELS = {
  '-': '-', '.': '.', '/': '/', '+': '+', '+/-': '+/-',
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', I: 'I', J: 'J', K: 'K', L: 'L',
  M: 'M', N: 'N', O: 'O', P: 'P', Q: 'Q', R: 'R', S: 'S', T: 'T', U: 'U', V: 'V', W: 'W', X: 'X',
  Y: 'Y', Z: 'Z', '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7',
  '8': '8', '9': '9',
  'Aft': '后', 'Forward': '前', 'Mid': '中', 'Left': '左', 'Right': '右', 'Up': '上', 'Down': '下',
  'All': '全部', 'Both': '两者', 'Clear': '清除', 'RST': '复位', 'Reset': '复位', 'Enter': '输入',
  'Exit': '退出', 'Print': '打印', 'Ident': '识别', 'Space': '空格', 'Date': '日期', 'Mech': '机械',
  'Door': '舱门', 'Overfly': '飞越', 'Sit down': '坐下', 'Stand up': '起身', 'Bugs': '速度基准游标',
  'ADF': 'ADF', 'ADF1': 'ADF1', 'ADF2': 'ADF2', 'ADR1': 'ADR1', 'ADR2': 'ADR2', 'ADR3': 'ADR3',
  'AM': 'AM', 'BFO': 'BFO（备用振荡器）', 'GLS': 'GLS（GBAS 着陆系统）', 'HF1': 'HF1', 'HF2': 'HF2',
  'ILS': 'ILS', 'IR1': 'IR1', 'IR2': 'IR2', 'IR3': 'IR3', 'LS': 'LS', 'MKR': 'MKR（指点标）',
  'MLS': 'MLS（微波着陆系统）', 'NAV': 'NAV', 'PA': 'PA（客舱广播）', 'R': 'R', 'VHF1': 'VHF1',
  'VHF2': 'VHF2', 'VHF3': 'VHF3', 'Voice': 'VOICE（语音）', 'VOR': 'VOR', 'VOR1': 'VOR1', 'VOR2': 'VOR2',
  'Interphone': '内话', 'Cabin interphone': '客舱内话', 'Flight interphone': '机组内话',
  'Standby bug': '备用速度基准游标', 'Loud speaker volume': '扬声器音量',
  'Aft cabin temperature': '后客舱温度', 'Forward cabin temperature': '前客舱温度',
  'Cockpit temperature': '驾驶舱温度', 'Rudder trim': '方向舵配平',
  'ND brightness': 'ND 亮度', 'PFD brightness': 'PFD 亮度', 'ND display mode': 'ND 显示方式',
  'ND display range': 'ND 显示范围', 'Terrain/WX brightness': '地形/气象雷达亮度',
  'Upper ECAM brightness': '上 ECAM 亮度', 'DCDU brightness': 'DCDU 亮度',
  'ECAM (captain)': 'ECAM（机长）', 'ECAM (F/O)': 'ECAM（副驾驶）', 'ECAM (normal)': 'ECAM（正常）',
  'EIS DMC (captain)': 'EIS DMC（机长）', 'EIS DMC (F/O)': 'EIS DMC（副驾驶）', 'EIS DMC (normal)': 'EIS DMC（正常）',
  'Air data (captain)': '大气数据（机长）', 'Air data (F/O)': '大气数据（副驾驶）', 'Air data (normal)': '大气数据（正常）',
  'ATT HDG (captain)': '姿态/航向（机长）', 'ATT HDG (F/O)': '姿态/航向（副驾驶）', 'ATT HDG (normal)': '姿态/航向（正常）',
  'Audio switching (captain)': '音频切换（机长）', 'Audio switching (F/O)': '音频切换（副驾驶）', 'Audio switching (normal)': '音频切换（正常）',
  'IR1 (ATT)': 'IR1（姿态）', 'IR2 (ATT)': 'IR2（姿态）', 'IR3 (ATT)': 'IR3（姿态）',
  'IR1 (NAV)': 'IR1（导航）', 'IR2 (NAV)': 'IR2（导航）', 'IR3 (NAV)': 'IR3（导航）',
  'IR1 (off)': 'IR1（关断）', 'IR2 (off)': 'IR2（关断）', 'IR3 (off)': 'IR3（关断）',
  'ADIRS data selector': 'ADIRS（大气惯导）数据选择', 'ADIRS system selector': 'ADIRS（大气惯导）系统选择',
  'Weather radar gain': '气象雷达增益', 'Weather radar tilt': '气象雷达俯仰',
  'Weather radar image selector': '气象雷达图像选择', 'Weather radar ground clutter suppression': '气象雷达地面杂波抑制',
  'Weather radar (off)': '气象雷达（关）', 'Weather radar (system 1)': '气象雷达（1 号系统）', 'Weather radar (system 2)': '气象雷达（2 号系统）',
  'Transponder (auto)': '应答机（自动）', 'Transponder (on)': '应答机（接通）', 'Transponder (standby)': '应答机（待命）',
  'Transponder mode (STBY)': '应答机方式（待命）', 'Transponder mode (TA)': '应答机方式（TA 交通通告）', 'Transponder mode (TA/RA)': '应答机方式（TA/RA 交通通告/决断）',
  'Transponder range mode': '应答机范围方式',
  'Engine mode (crank)': '发动机方式（干转）', 'Engine mode (normal)': '发动机方式（正常）', 'Engine mode (start)': '发动机方式（起动）',
  'Speed selector': '速度选择窗', 'Heading selector': '航向选择窗', 'Altitude selector': '高度选择窗',
  'BARO selector': '气压基准选择窗', 'BARO button': '气压基准按钮', 'Standby BARO selector': '备用气压基准选择窗',
  'Vertical speed selector': '垂直速度选择窗', 'Cross bleed (auto)': '交叉引气（自动）', 'Cross bleed (open)': '交叉引气（打开）', 'Cross bleed (shut)': '交叉引气（关闭）',
  'Landing elevation': '着陆标高', 'FCU integral lighting brightness': 'FCU 整体照明亮度',
  'FCU readouts brightness': 'FCU 显示亮度', 'Main panel & pedestal integral lighting brightness': '主面板与中央操纵台整体照明亮度',
  'Main panel flood light brightness': '主面板泛光亮度', 'Pedestal flood light brightness': '中央操纵台泛光亮度',
  'Overhead integral lighting brightness': '顶板整体照明亮度', 'Chart light brightness': '航图灯亮度',
  'Captain map light brightness': '机长地图灯亮度', 'F/O map light brightness': '副驾驶地图灯亮度',
  'Reading light brightness': '阅读灯亮度', 'Elapsed time counter': '经过时间计数器',
  'Aft cargo fire extinguisher': '后货舱灭火瓶', 'Forward cargo fire extinguisher': '前货舱灭火瓶',
  'Bulk cargo door handle': '散装货舱门手柄', 'Front cargo door handle': '前货舱门手柄', 'Rear cargo door handle': '后货舱门手柄',
  'Window latch': '侧窗锁', 'Left throttle': '左油门杆', 'Right throttle': '右油门杆',
  'AIDS Print': 'AIDS（飞机综合数据系统）打印', 'DFDR event': 'DFDR（数字飞行数据记录器）事件标记',
  'SVCE INT Override': 'SERVICE INT（勤务内话）超控', 'Left windshield wiper': '左风挡雨刷',
  'Right windshield wiper': '右风挡雨刷', 'Left windshield wiper (fast)': '左风挡雨刷（快）',
  'Left windshield wiper (slow)': '左风挡雨刷（慢）', 'Left windshield wiper (off)': '左风挡雨刷（关）',
  'Right windshield wiper (fast)': '右风挡雨刷（快）', 'Right windshield wiper (slow)': '右风挡雨刷（慢）',
  'Right windshield wiper (off)': '右风挡雨刷（关）', 'Rain repellent': '排雨剂',
  'Autobrake low': '自动刹车 低', 'Autobrake medium': '自动刹车 中', 'Autobrake maximum': '自动刹车 最大',
  'Flaps (Up)': '襟翼（收上）', 'Flaps (1)': '襟翼 1', 'Flaps (2)': '襟翼 2', 'Flaps (3)': '襟翼 3', 'Flaps (Full)': '襟翼全放出',
  'AP disconnect': '断开自动驾驶', 'Disconnect autothrottle': '断开自动推力',
  'Engage pedal disconnect': '脚蹬脱离器—接通', 'Disengage pedal disconnect': '脚蹬脱离器—脱离',
  'Next page': '下一页', 'Previous page': '上一页', 'Next message': '下一条信息', 'Previous message': '上一条信息',
  'Light test': '灯光测试', 'Test readouts and annunciators': '测试显示与指示', 'GPWS self-test': 'GPWS 自检测',
  'Cabin interphone': '客舱内话', 'Cockpit call': '呼叫驾驶舱', 'Emergency gear handle': '应急放起落架手柄',
  'Lock emergency gear handle': '锁定应急放起落架手柄', 'Unlock emergency gear handle': '解除应急放起落架手柄锁定',
  'Set parking brake': '设置停机刹车', 'Release parking brake': '松开停机刹车',
  'Release gust lock': '解除风锁', 'Lock cockpit door': '锁定驾驶舱门', 'Unlock cockpit door': '解锁驾驶舱门',
  'Lock window': '锁定侧窗', 'Unlock window': '解锁侧窗', 'Lock loud speaker volume knob': '锁定扬声器音量旋钮',
  'Unlock loud speaker volume knob': '解锁扬声器音量旋钮', 'Unlock ND brightness knob': '解锁 ND 亮度旋钮',
  'Unlock PFD brightness knob': '解锁 PFD 亮度旋钮', 'Unlock Terrain/WX brightness knob': '解锁地形/气象雷达亮度旋钮',
  'Unlock lower ECAM brightness knob': '解锁下 ECAM 亮度旋钮', 'Unlock upper ECAM brightness knob': '解锁上 ECAM 亮度旋钮',
  'Lift armrest': '抬起扶手', 'Lower armrest': '放下扶手', 'Deploy RAT': '放出 RAT（冲压空气涡轮）',
  'Stow RAT': '收回 RAT（冲压空气涡轮）', 'Deploy standby compass': '放出备用罗盘', 'Stow standby compass': '收回备用罗盘',
  'Stow CCTV': '收回 CCTV（舱门监控）', 'Unlatch CCTV': '解开 CCTV（舱门监控）',
  'Place wheel chock': '放置轮挡', 'Remove wheel chock': '撤除轮挡', 'Plug in GPU': '接入 GPU（地面电源）', 'Unplug GPU': '断开 GPU（地面电源）',
  'Slide window': '滑动侧窗', 'Slide jumpseat': '滑动折叠座椅', 'Stow jumpseat': '收起折叠座椅',
  'Lower jumpseat headrest': '放低折叠座椅头靠', 'Raise jumpseat headrest': '升起折叠座椅头靠',
  'Pull out tray table': '拉出小桌板', 'Put away tray table': '收好小桌板',
  'Lower sun shade': '放下遮阳帘', 'Raise sun shade': '收起遮阳帘',
  'Lower window shade': '放下遮阳板', 'Raise window shade': '收起遮阳板',
  'Lower landing gear': '放下起落架', 'Raise landing gear': '收起起落架',
  'Drag fan blades': '盘动风扇叶片', 'Stop fan blades': '刹停风扇叶片',
  'Cage artificial horizon': '解除姿态仪旗标', 'Cycle pages on ECAM': '翻页循环（ECAM）',
  'Cycle chronometer modes on ND': '循环 ND 计时器方式', 'Recall cleared ECAM messages': '调回已清除的 ECAM 信息',
  'Cancel ECAM emergency message': '取消 ECAM 紧急信息', 'Erase CVR': '擦除 CVR（驾驶舱语音记录器）',
  'Start/stop chronometer': '启动/停止计时器', 'Reset chronometer': '复位计时器', 'Reset rudder trim': '重置方向舵配平',
  'Reset Oxygen TMR': '复位氧气定时器', 'Swap active and standby frequencies': '交换主/备频率',
  'Swap PFD and ND': '互换 PFD 与 ND', 'Show EFB': '显示 EFB（电子飞行包）', 'Hide EFB': '隐藏 EFB（电子飞行包）',
  'Show BARO in hPa': '气压基准显示 hPa', 'Show BARO in inHg': '气压基准显示 inHg',
  'Tune frequency (kHz)': '微调频率（kHz）', 'Tune frequency (MHz)': '微调频率（MHz）',
  'Validate current aircraft config for takeoff': '校验当前起飞构型',
  'Manual vertical speed control': '人工垂直速度控制', 'Manual vertical speed control (Down)': '人工垂直速度控制（向下）',
  'Manual vertical speed control (Up)': '人工垂直速度控制（向上）',
  'Adjust refuel amount': '调整加油量', 'Adjust standby bug': '调整备用速度基准游标',
  'Adjust captain\u2019s seat distance': '调整机长座椅前后', 'Adjust captain\u2019s seat height': '调整机长座椅高度',
  "Adjust captain's seat distance": '调整机长座椅前后', "Adjust captain's seat height": '调整机长座椅高度',
  'Adjust F/O\u2019s seat distance': '调整副驾驶座椅前后', 'Adjust F/O\u2019s seat height': '调整副驾驶座椅高度',
  "Adjust F/O's seat distance": '调整副驾驶座椅前后', "Adjust F/O's seat height": '调整副驾驶座椅高度',
  'Decrease aft cargo temperature': '调低后货舱温度', 'Increase aft cargo temperature': '调高后货舱温度',
  'Toggle Galley and cabin': '接通/断开厨房与客舱', 'Toggle auto cabin oxygen mask doors': '自动开闭客舱氧气面罩舱门',
  'Toggle between current time and current date': '在时间与日期间切换',
  'Toggle heading/VS readout between HDG/VS and TRK/FPA': '在 HDG/VS 与 TRK/FPA 显示间切换',
  'Toggle speed readout between knots and Mach': '在海里/节与马赫数间切换',
  'Toggle cockpit recorder': '接通/断开座舱记录器', 'Toggle avionics compartment light': '接通/断开电子设备舱灯',
  'Allow evacuation alert from cockpit': '允许从驾驶舱发出撤离告警',
  'Allow evacuation alert from cockpit and cabin': '允许从驾驶舱与客舱发出撤离告警',
  'Shut off evacuation horn': '关闭撤离喇叭', 'Test oxygen mask': '测试氧气面罩',
  'Set internal time and date': '设置内部时间与日期', 'Set cabin pressurization to auto': '客舱增压设为自动',
  'Set cabin pressurization to manual': '客舱增压设为人工', 'Set battery power to NORM': '电池电源设为 NORM',
  'Set battery power to ON': '电池电源设为 ON', 'Set parking brake': '设置停机刹车',
  'Arm emergency slide': '预位应急滑梯', 'Disarm emergency slide': '解除应急滑梯预位',
  'Enable flap 3 landing mode': '启用襟翼 3 落地方式', 'Disable flap 3 landing mode': '禁用襟翼 3 落地方式',
  'Enable rudder lockout': '启用方向舵锁定', 'Disable rudder lockout': '禁用方向舵锁定',
  'Display GPS time and date': '显示 GPS 时间与日期', 'Display internal time and date': '显示内部时间与日期',
  'Adjust vertical speed': '调整垂直速度', 'Adjust selected speed': '调整选定速度',
  'Adjust selected altitude': '调整选定高度', 'Adjust selected heading': '调整选定航向',
  'Adjust selected date': '调整选定日期',
  'Show/hide altitude in meters on lower ECAM': '下 ECAM 显示/隐藏米制高度',
  // --- leftovers from the first pass, all authored (nothing inferred by rule)
  'Discharge aft cargo fire extinguisher (agent 1)': '释放后货舱灭火瓶（剂 1）',
  'Discharge aft cargo fire extinguisher (agent 2)': '释放后货舱灭火瓶（剂 2）',
  'Discharge forward cargo fire extinguisher (agent 1)': '释放前货舱灭火瓶（剂 1）',
  'Discharge forward cargo fire extinguisher (agent 2)': '释放前货舱灭火瓶（剂 2）',
  'Discharge left engine fire extinguisher (agent 1)': '释放左发灭火瓶（剂 1）',
  'Discharge left engine fire extinguisher (agent 2)': '释放左发灭火瓶（剂 2）',
  'Discharge right engine fire extinguisher (agent 1)': '释放右发灭火瓶（剂 1）',
  'Discharge right engine fire extinguisher (agent 2)': '释放右发灭火瓶（剂 2）',
  'Discharge APU fire extinguisher agent': '释放 APU 灭火瓶',
  'Cargo door manual selector valve': '货舱门人工选择活门',
  'Cargo door manual selector valve (close)': '货舱门人工选择活门（关闭）',
  'Cargo door manual selector valve (open)': '货舱门人工选择活门（打开）',
  'Close aft cargo door selector panel': '关闭后货舱门选择面板',
  'Open aft cargo door selector panel': '打开后货舱门选择面板',
  'Close forward cargo door selector panel': '关闭前货舱门选择面板',
  'Open forward cargo door selector panel': '打开前货舱门选择面板',
  'Door control handle': '舱门控制手柄',
  'APU shut off': 'APU 关断',
  'APU auto exiting reset': 'APU 自动退出保护复位',
  'APU auto exiting test': 'APU 自动退出保护测试',
  'Cockpit door lock': '驾驶舱门锁',
  'Pack flow (high)': '组件流量（高）',
  'Pack flow (low)': '组件流量（低）',
  'Pack flow (normal)': '组件流量（正常）',
  'ACT FQI Selector': 'ACT FQI（加油活门作动器/燃油量指示）选择',
  'Navigation & logo lights (on)': '航行灯与标志灯（接通）',
  'Nose light (taxi)': '机头灯（滑行）',
  'Nose light (take off)': '机头灯（起飞）',
  'Nose light (off)': '机头灯（关闭）',
  'Lower ECAM brightness': '调低下 ECAM 亮度',
  'Clear ECAM message': '清除 ECAM 信息',
  'Clear ATC reminder': '清除 ATC 提醒',
  'Clear autoland warning': '清除自动着陆警告',
  'Clear master caution': '清除主警戒',
  'Clear master warning': '清除主警告',
  'Release bulk cargo door handle': '松开散装货舱门手柄',
  'Set altitude selector scale to hundred foot increments': '高度窗刻度设为 100 英尺',
  'Set altitude selector scale to thousand foot increments': '高度窗刻度设为 1000 英尺',
  'Set weather radar multiscan to auto': '气象雷达多扫描设为自动',
  'Set weather radar multiscan to manual': '气象雷达多扫描设为人工',
  'Set weather radar PWS to auto': '气象雷达 PWS（预测式风切变）设为自动',
  'Set weather radar PWS to off': '气象雷达 PWS（预测式风切变）设为关断',
  'Set transponder ATC to 1': '应答机 ATC 天线设为 1',
  'Set transponder ATC to 2': '应答机 ATC 天线设为 2',
  'Show/hide flight director command bars on PFD': 'PFD 显示/隐藏指引指令杆',
  'Show/hide localizer and glideslope on PFD': 'PFD 显示/隐藏航道与下滑道',
  'Show/hide terrain on ND': 'ND 显示/隐藏地形',
  'Disable anti-skid and nose wheel steering': '禁用防滑与前轮转弯', 'Enable anti-skid and nose wheel steering': '启用防滑与前轮转弯',
};

const STATE_ZH = {
  on: '接通', off: '断开', open: '打开', close: '关闭', closed: '关闭', shut: '关闭', auto: '自动',
  armed: '预位', norm: '正常位', normal: '正常位', high: '高', low: '低', standby: '待命', stby: '待命', dim: '暗',
  bright: '亮', test: '测试', retract: '收上', retracted: '收上', crank: '干转', start: '起动',
  fast: '快', slow: '慢', system1: '1 号系统', system2: '2 号系统', tax: '滑行', 'taxi': '滑行',
  'take off': '起飞', 'takeoff': '起飞', manual: '人工', mode1: '方式 1',
};

/** Pages shown on the ECAM SD — English name -> Chinese page name. */
const SD_PAGES = {
  'air bleed': '引气', 'air conditioning': '空调', 'apu': 'APU', 'cabin pressure': '客舱增压',
  'door/oxygen': '舱门/氧气', 'electrical': '电气', 'engine': '发动机', 'fuel': '燃油',
  'hydraulic': '液压', 'control': '飞行操纵', 'flight control': '飞行操纵', 'status': '状态', 'wheel': '起落架',
  'landing gear and spoiler': '起落架与扰流板',
  'crank': '干转', 'apprm': '进近', 'approach': '进近',
};
/** ND overlay layers. */
const ND_SYMBOLS = {
  'airport': '机场',
  'ndb': 'NDB',
  'vor, dme, and tacan': 'VOR/DME/TACAN',
  'waypoint': '航路点',
  'constraint': '限制点',
  'terrain': '地形',
  'weather radar': '气象雷达回波',
};
/** Extra state words that appear only in "Set ... to ..." position. */
const ND_NOTES = {};
const MCDU_PAGES = {
  'F-PLN': 'F-PLN（飞行计划）', 'SEC F-PLN': 'SEC F-PLN（备用飞行计划）', 'PERF': 'PERF（性能）',
  'PROG': 'PROG（进度）', 'INIT': 'INIT（初始）', 'DATA': 'DATA（数据）', 'RAD NAV': 'RAD NAV（无线电导航）',
  'AIRPORT': 'AIRPORT（机场）', 'ATC COMM': 'ATC COMM（管制通信）', 'FUEL PRED': 'FUEL PRED（燃油预测）',
  'MCDU MENU': 'MCDU MENU（MCDU 菜单）', 'DIR': 'DIR（直接进近）',
};

/** Fenix writes dynamic tooltips as inline macros whose branch literals are display text
 *  ("... %{if}Armed%{else}..."). Translate only those literals; every byte of macro
 *  syntax (simvar names, operators, %!d! formats) is copied through untouched. */
const MACRO_WORDS = {
  OFF: '关断', ON: '接通', NAV: '导航', ADR: '大气数据', ATT: '姿态', SHUT: '关闭', OPEN: '打开',
  NEUTRAL: '中立', ARMED: '预位', CLOSE: '关闭', UP: '上', DOWN: '下', ALL: '全部',
};
function zhMacro(body) {
  return body.replace(/%\{(?:if|else|:\d*)\}([A-Za-z][A-Za-z /-]*?)(?=%\{|$|\))/g, (whole, w) => {
    const k = w.trim().toUpperCase();
    return MACRO_WORDS[k] == null ? whole : whole.slice(0, whole.length - w.length) + MACRO_WORDS[k];
  });
}

const PATTERNS = [
  [
    /^Turn on (.+)$/,
    (m) => on(m[1]),
  ],
  [/^Turn off (.+)$/, (m) => off(m[1])],
  [/^Open (.+?) cover$/, (m) => { const s = S(m[1]); return s ? `打开${s.zh}护罩` : null; }],
  [/^Close (.+?) cover$/, (m) => { const s = S(m[1]); return s ? `关闭${s.zh}护罩` : null; }],
  [/^Open (.+)$/, (m) => { const s = S(m[1]); return s ? `${CLASS_VERBS[s.cls][0]}${s.zh}` : null; }],
  [/^Close (.+)$/, (m) => { const s = S(m[1]); return s ? `${CLASS_VERBS[s.cls][1]}${s.zh}` : null; }],
  [/^Adjust (.+?) volume$/, (m) => { const s = S(m[1]); return s ? `调节${s.zh}音量` : null; }],
  [/^Adjust (.+)$/, (m) => { const s = S(m[1]); return s ? `调整${s.zh}` : null; }],
  [/^Decrease (.+)$/, (m) => { const s = S(m[1]); return s ? `调低${s.zh}` : null; }],
  [/^Increase (.+)$/, (m) => { const s = S(m[1]); return s ? `调高${s.zh}` : null; }],
  [/^Enable (.+)$/, (m) => { const s = S(m[1]); return s ? `启用${s.zh}` : null; }],
  [/^Disable (.+)$/, (m) => { const s = S(m[1]); return s ? `禁用${s.zh}` : null; }],
  [/^Clear (.+)$/, (m) => { const s = S(m[1]); return s ? `清除${s.zh}` : null; }],
  [/^Release (.+)$/, (m) => { const s = S(m[1]); return s ? `松开${s.zh}` : null; }],
  [/^Engage\/Disengage (.+)$/, (m) => { const s = S(m[1]); return s ? `接通\/断开${s.zh}` : null; }],
  [/^Engage (.+)$/, (m) => { const s = S(m[1]); return s ? `接通${s.zh}` : null; }],
  [/^Toggle (.+)$/, (m) => { const s = S(m[1]); return s ? `切换${s.zh}` : null; }],
  [/^Test (.+)$/, (m) => { const s = S(m[1]); return s ? `测试${s.zh}` : null; }],
  [/^Display (.+?) page on ECAM$/i, (m) => { const p = SD_PAGES[lower(m[1])]; return p ? `在 ECAM 显示${p}页` : null; }],
  [/^Display (.+?) Page$/, (m) => { const k = norm(m[1]).toUpperCase(); const p = MCDU_PAGES[k]; return p ? `显示 ${p} 页` : null; }],
  [/^Select line (\d)$/, (m) => `选择第 ${m[1]} 行`],
  [/^Set (.+?) to (.+)$/, (m) => {
    const s = S(m[1]);
    if (!s) return null;
    const st = STATE_ZH[lower(m[2])] ?? ND_NOTES[lower(m[2])] ?? null;
    return st == null ? null : `将${s.zh}设为${st}`;
  }],
  [/^Transmit on (.+)$/, (m) => { const s = S(m[1]); return s ? `在${s.zh}上发射` : null; }],
  [/^Show\/Hide (.+?) symbols on ND$/i, (m) => { const p = ND_SYMBOLS[lower(m[1])]; return p ? `ND 显示/隐藏${p}符号` : null; }],
  [/^Show\/hide (.+?) on ND$/i, (m) => { const p = ND_SYMBOLS[lower(m[1])]; return p ? `ND 显示/隐藏${p}` : null; }],
  [/^NAV(\d) bearing pointer on ND \((.+)\)$/, (m) => `ND 上 NAV${m[1]} 方位指针（${m[2].toUpperCase()}）`],
  [/^(\w[\w&/ .-]*?) \((bright|dim|off|on|auto|armed|normal|high|low|standby|stby|crank|start|fast|slow|retracted|system 1|system 2|take off|taxi|tax|open|closed|shut|test|1|2|3|Full|Up|ATT|NAV|captain|F\/O|agent \d)\)$/i, (m) => {
    const s = S(m[1]);
    if (!s) return null;
    const key = lower(m[2]).replace(/^system /, 'system');
    const st = /^\d$/.test(m[2]) ? m[2] : STATE_ZH[key] ?? norm(m[2]);
    return `${s.zh}（${st}）`;
  }],
  [/^Lower (.+)$/, (m) => { const s = S(m[1]); return s ? `放下${s.zh}` : null; }],
  [/^Raise (.+)$/, (m) => { const s = S(m[1]); return s ? `收起${s.zh}` : null; }],
  [/^Unlock (.+)$/, (m) => { const s = S(m[1]); return s ? `解锁${s.zh}` : null; }],
  [/^Lock (.+)$/, (m) => { const s = S(m[1]); return s ? `锁定${s.zh}` : null; }],
  [/^(.*) brightness$/, (m) => { const s = S(`${m[1]} brightness`.replace(/\s+/g, ' ')); return s ? `${s.zh}亮度` : null; }],
  // last resort: an inline-macro tooltip (%( ... )% / %{if} / %!d! are all display macros)
  [/^.+$/, (m, full) => {
    if (!/%[(%!]/.test(full)) return null;
    const hm = full.match(/^([^%(]+?)\s*\((%[\s\S]*)\)$/);
    if (hm) {
      const s = S(hm[1]);
      return s ? `${s.zh}（${zhMacro(hm[2])}）` : null;
    }
    return zhMacro(full);
  }],
];

const en = readLocPak(listLocPakFiles(PKG).find((p) => /^en-us$/i.test(p.language)).file).strings;
const tooltipSource = Object.fromEntries(Object.entries(en).filter(([k]) => isTooltipKey(k)));

const { dict, todo, provenance, audit: probs } = compile(tooltipSource, {
  PRESERVE,
  EXACT: LABELS,
  PATTERNS,
  SUBJECTS: Object.fromEntries(Object.entries(SUBJECTS).map(([k, v]) => [k, v.zh])),
});

const tally = {};
for (const p of Object.values(provenance)) tally[p] = (tally[p] ?? 0) + 1;
console.log(`# fenix-a320: ${Object.keys(tooltipSource).length} keys -> ${Object.keys(dict).length} translated, ${todo.length} TODO`);
console.log(`# provenance: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`# audit: latinLeftover=${probs.latinLeftover.length} unbalanced=${probs.unbalanced.length} tooLong=${probs.tooLong.length} empty=${probs.empty.length}`);
for (const p of probs.latinLeftover.slice(0, 12)) console.log(`   LATIN  ${p.key}\n          EN ${p.en}\n          ZH ${p.zh}  ${p.words ? '[' + p.words.join(',') + ']' : ''}`);
for (const p of probs.unbalanced.slice(0, 8)) console.log(`   PAREN  ${p.en} -> ${p.zh}`);
for (const p of probs.tooLong.slice(0, 8)) console.log(`   LONG   ${p.zh}  (${p.zh.length})`);
console.log(`\n## TODO (no rule matched — nothing invented)`);
const seen = new Set();
for (const t of todo) {
  if (seen.has(t.en)) continue;
  seen.add(t.en);
  if (seen.size > SHOW) break;
  console.log(`   ${t.en}`);
}
console.log(`# distinct TODO strings: ${new Set(todo.map((t) => t.en)).size}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ dict, todo }, null, 1));
console.log(`# wrote ${OUT}${WRITE ? ' (--write)' : ' [dry]'}`);
