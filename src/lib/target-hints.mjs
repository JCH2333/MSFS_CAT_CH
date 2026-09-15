// 手动选择插件目录的引导文案：
// 设置页与目录选择弹窗共用，让用户不看文档也知道该选哪一层目录。
import { DUAL_SIM_SLOTS } from './dual-sim.mjs'

const PATCH_TARGET_HINTS = {
  'gsx-pro-zh-cn': '选择社区文件夹（Community）里的 GSX Pro 插件包文件夹：名为 fsdreamteam-gsx-pro 或 gsx-pro、里面有 manifest.json 的那一层',
  'gsx-pro-zh-cn-voice': '选择 FSDreamTeam Addon Manager 的 GSX 目录：…\\Addon Manager\\couatl\\GSX，里面有 sounds 文件夹'
}

export function manualTargetHint(patch) {
  return PATCH_TARGET_HINTS[patch?.id] || patch?.targetHint || '请选择安装目录'
}

export function slotManualHint(slotId) {
  return DUAL_SIM_SLOTS.find(({ id }) => id === slotId)?.hint || ''
}
