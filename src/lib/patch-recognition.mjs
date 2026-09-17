import { describeDualSim, isDualSimPatch } from './dual-sim.mjs'

// 识别/安装请求与目标检测共用 dual-sim.mjs 的 describeDualSim（服务端 dualSim 字段 >
// 内置回退表），保证对未下发 dualSim 的旧目录仍能做多槽位社区安装。
// 注意：不得在此处复制实现或透传 patch.dualSim 本体——目录存于 reactive 状态时它是
// Vue Proxy，越过 IPC 会抛 "An object could not be cloned."（2.1.1 目录页回归根因）。

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
