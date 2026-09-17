// iniBuilds 机模汉化多模拟器安装模型：
// 补丁安装到每个已安装模拟器的社区文件夹根目录（ZIP 内自带补丁包目录前缀），
// 一键安装对两个槽位同时进行，缺失的模拟器直接跳过。
// 多模拟器安装由服务端目录的 dualSim 字段开启；内置表仅用于兼容未携带该字段的旧目录。

export const BUILTIN_MULTI_SIM_PATCH_IDS = new Set(['ini350-efb-zh-cn', 'inia380-efb-zh-cn'])

export const DUAL_SIM_SLOTS = [
  {
    id: 'msfs2024',
    label: 'MSFS 2024',
    hint: '请选择 MSFS 2024 的社区文件夹（Community 或 Community2024）'
  },
  {
    id: 'msfs2020',
    label: 'MSFS 2020',
    hint: '请选择 MSFS 2020 的社区文件夹（Community）'
  }
]

export function isDualSimPatch(patch) {
  return Boolean(patch?.dualSim) || BUILTIN_MULTI_SIM_PATCH_IDS.has(patch?.id)
}

// 交给主进程的多模拟器标记：把服务端配置重建为纯字符串对象。
// 绝不能透传 patch.dualSim 本体——目录存于 reactive 状态时它是 Vue Proxy，
// 越过 IPC 的结构化克隆边界会抛 "An object could not be cloned."（2.1.1 目录页回归的根因）。
// 旧目录无该字段时按内置回退表开启默认双槽位。
export function describeDualSim(patch) {
  if (patch?.dualSim) {
    const slots = Array.isArray(patch.dualSim.slots) ? patch.dualSim.slots : []
    return {
      slots: slots
      .map((entry) => ({
        slot: typeof entry?.slot === 'string' ? entry.slot.trim().toLowerCase() : '',
        communityFolder: typeof entry?.communityFolder === 'string' ? entry.communityFolder.trim() : ''
      }))
      .filter((entry) => entry.slot)
    }
  }
  if (BUILTIN_MULTI_SIM_PATCH_IDS.has(patch?.id)) return { slots: [] }
  return null
}

// 按服务端配置解析该补丁的模拟器槽位（slots 为空或缺省时默认双槽位）
export function multiSimSlotsFor(patch) {
  const configured = Array.isArray(patch?.dualSim?.slots) ? patch.dualSim.slots : []
  const ids = [...new Set(configured
    .map((entry) => (typeof entry?.slot === 'string' ? entry.slot.trim().toLowerCase() : ''))
    .filter((id) => DUAL_SIM_SLOTS.some((option) => option.id === id)))]
  return ids.length ? DUAL_SIM_SLOTS.filter((option) => ids.includes(option.id)) : DUAL_SIM_SLOTS
}

function slotEntry(slots, slotId) {
  return Array.isArray(slots) ? slots.find((slot) => slot?.slot === slotId) || null : null
}

export function installationSlotPath(installation, slotId) {
  return slotEntry(installation?.slots, slotId)?.targetPath || null
}

export function detectedSlotPath(detected, slotId) {
  return slotEntry(detected?.slots, slotId)?.targetPath || null
}

// 旧版本客户端把单路径字符串直接存在 targets[patchId]，按惯例视为 2024 槽位
export function manualSlotPaths(targets, patchId) {
  const value = targets?.[patchId]
  if (!value) return { msfs2024: '', msfs2020: '' }
  if (typeof value === 'string') return { msfs2024: value, msfs2020: '' }
  return {
    msfs2024: typeof value.msfs2024 === 'string' ? value.msfs2024 : '',
    msfs2020: typeof value.msfs2020 === 'string' ? value.msfs2020 : ''
  }
}

export function resolveSlotTarget(state, patch, slotId) {
  return manualSlotPaths(state.targets, patch.id)[slotId]
    || installationSlotPath(state.installations?.[patch.id], slotId)
    || detectedSlotPath(state.detectedTargets?.[patch.id], slotId)
    || null
}

// 汇总一次安装要写入的目标：单目标补丁返回 [{slot:null, path}]，双版本补丁按 2024→2020 给出可用槽位
export function collectInstallTargets(state, patch) {
  if (!isDualSimPatch(patch)) {
    const legacy = state.targets?.[patch.id]
      || state.installations?.[patch.id]?.targetPath
      || state.detectedTargets?.[patch.id]?.targetPath
      || null
    return legacy ? [{ slot: null, path: legacy }] : []
  }
  return multiSimSlotsFor(patch)
    .map(({ id }) => ({ slot: id, path: resolveSlotTarget(state, patch, id) }))
    .filter((entry) => entry.path)
}

export function hasAnyTarget(state, patch) {
  return collectInstallTargets(state, patch).length > 0
}
