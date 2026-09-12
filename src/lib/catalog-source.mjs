export function catalogSourcePresentation(source) {
  if (source === 'server') return { label: '\u4e91\u7aef\u5df2\u540c\u6b65', online: true }
  if (source === 'cache') return { label: '\u4f7f\u7528\u672c\u5730\u7f13\u5b58', online: false }
  return { label: '\u7b49\u5f85\u540c\u6b65', online: false }
}
