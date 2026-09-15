// iniBuilds A350 汉化双模拟器安装模型：
// 同一补丁在 MSFS 2024 与 MSFS 2020 的社区文件夹各有一个安装目标（槽位），
// 一键安装对两个槽位同时进行，缺失的槽位直接跳过。

export const A350_MARKER_FOLDER = 'inibuilds-aircraft-a350'

export const DUAL_SIM_PATCH_IDS = new Set(['ini350-efb-zh-cn'])

export const DUAL_SIM_SLOTS = [
  {
    id: 'msfs2024',
    label: 'MSFS 2024',
    hint: '请选择 MSFS 2024 的社区文件夹（Community 或 Community2024，其中应能看到 inibuilds-aircraft-a350 文件夹）'
  },
  {
    id: 'msfs2020',
    label: 'MSFS 2020',
    hint: '请选择 MSFS 2020 的社区文件夹（Community，其中应能看到 inibuilds-aircraft-a350 文件夹）'
  }
]

export function isDualSimPatch(patch) {
  return DUAL_SIM_PATCH_IDS.has(patch?.id)
}

// 交给主进程的定位标记：检测与安装校验都以"A350 本体包目录"为准
export function describeDualSim(patch) {
  return isDualSimPatch(patch) ? { markerFolder: A350_MARKER_FOLDER } : null
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
  return DUAL_SIM_SLOTS
    .map(({ id }) => ({ slot: id, path: resolveSlotTarget(state, patch, id) }))
    .filter((entry) => entry.path)
}

export function hasAnyTarget(state, patch) {
  return collectInstallTargets(state, patch).length > 0
}
