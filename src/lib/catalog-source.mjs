export function catalogSourcePresentation(source) {
  if (source === 'gitee') return { label: 'Gitee \u5df2\u540c\u6b65', online: true }
  if (source === 'github') return { label: 'GitHub \u5df2\u540c\u6b65', online: true }
  if (source === 'mirror') return { label: '\u56fd\u5185\u955c\u50cf\u5df2\u540c\u6b65', online: true }
  if (source === 'cache') return { label: '\u4f7f\u7528\u672c\u5730\u7f13\u5b58', online: false }
  return { label: '\u7b49\u5f85\u540c\u6b65', online: false }
}
