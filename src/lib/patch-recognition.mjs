import { isDualSimPatch } from './dual-sim.mjs'

// 识别/安装请求与目标检测共用同一套多模拟器判定（服务端 dualSim 字段 > 内置回退表），
// 保证对未下发 dualSim 的旧目录仍能做多槽位社区安装。
function describeDualSim(patch) {
  if (patch?.dualSim) return patch.dualSim
  return isDualSimPatch(patch) ? { slots: [] } : null
}

export function createRecognitionDescriptors(patches) {
  if (!Array.isArray(patches)) return []

  return patches.map((patch) => ({
    id: typeof patch?.id === 'string' ? patch.id : '',
    name: typeof patch?.name === 'string' ? patch.name : '',
    version: typeof patch?.version === 'string' ? patch.version : '',
    targetKind: typeof patch?.targetKind === 'string' ? patch.targetKind : 'addon',
    dualSim: describeDualSim(patch),
    fingerprint: Array.isArray(patch?.fingerprint)
      ? patch.fingerprint.map((file) => ({
        target: typeof file?.target === 'string' ? file.target : 'primary',
        relativePath: typeof file?.relativePath === 'string' ? file.relativePath : '',
        sha256: typeof file?.sha256 === 'string' ? file.sha256 : ''
      }))
      : []
  }))
}

export function createInstallationRequest(patch) {
  return {
    ...createRecognitionDescriptors([patch])[0],
    status: typeof patch?.status === 'string' ? patch.status : '',
    targetKind: typeof patch?.targetKind === 'string' ? patch.targetKind : 'addon',
    package: {
      downloadUrl: typeof patch?.package?.downloadUrl === 'string' ? patch.package.downloadUrl : '',
      sha256: typeof patch?.package?.sha256 === 'string' ? patch.package.sha256 : '',
      contentRoot: typeof patch?.package?.contentRoot === 'string' ? patch.package.contentRoot : '',
      installPlan: Array.isArray(patch?.package?.installPlan)
        ? patch.package.installPlan.map((entry) => ({
            target: typeof entry?.target === 'string' ? entry.target : '',
            contentRoot: typeof entry?.contentRoot === 'string' ? entry.contentRoot : ''
          }))
        : []
    }
  }
}
