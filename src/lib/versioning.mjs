// 版本比较纯函数（渲染层 ESM 版）。
// electron/versioning.js 是 CommonJS（主进程 require 使用）；浏览器 dev 模式下
// Vite 无法对工作区内的 CJS 文件做具名导入互操作（白屏），故此处提供等价 ESM 实现。
// 两份实现必须保持一致：tests/versioning-parity.test.js 守护。

function parseVersion(input) {
  if (typeof input !== 'string') return null

  const match = input.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue

    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Number(a) > Number(b) ? 1 : -1
    if (aNumeric) return -1
    if (bNumeric) return 1
    return a > b ? 1 : -1
  }
  return 0
}

function compareVersions(leftInput, rightInput) {
  const left = parseVersion(leftInput)
  const right = parseVersion(rightInput)
  if (!left || !right) {
    throw new Error('版本必须采用语义化格式，例如 1.2.3')
  }

  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

function isSemanticVersion(input) {
  return Boolean(parseVersion(input))
}

export { comparePrerelease, compareVersions, isSemanticVersion, parseVersion }
