// GSX 系补丁的插件版本守卫评估（纯函数，便于测试与复用）。
//
// 返回：
// - 'ok'：版本一致，或任一版本号缺失/非法（不阻塞，交由目标探测兜底）；
// - 'gsx-older'：本机 GSX 低于补丁适配版本，需先在「GSX 更新」页更新 GSX；
// - 'gsx-newer'：本机 GSX 高于补丁适配版本。补丁捆绑的官方 manifest.json 与面板
//   文件以适配版本为准，强行安装会把新版本的版本标记与文件内容倒退回旧版
//   （2026-09 事故：v1.2.8 在 GSX 4.0.23 上覆盖版本标记，客户端误报"幽灵 4.0.21"、
//   更新页与补丁页互相死锁），必须拦截并提示等待适配新版。
import { compareVersions, isSemanticVersion } from '../../electron/versioning.js'

export function assessGsxPatchVersion(localVersion, addonVersion) {
  if (!localVersion || !addonVersion) return 'ok'
  if (!isSemanticVersion(localVersion) || !isSemanticVersion(addonVersion)) return 'ok'
  const compared = compareVersions(localVersion, addonVersion)
  if (compared < 0) return 'gsx-older'
  if (compared > 0) return 'gsx-newer'
  return 'ok'
}

// 守卫对话框形态：'gsx-newer' 渲染"补丁适配版本低于当前 GSX"，其余渲染"版本过低"。
// （2.2.0 事故：守卫返回 'gsx-newer' 而对话框比较 'newer'，较新场景错误渲染了过低文案。）
export function guardDialogVariant(verdict) {
  return verdict === 'gsx-newer' ? 'newer' : 'older'
}
