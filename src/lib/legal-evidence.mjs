// 协议同意存证（法律证据留存）渲染层辅助。
// 哈希在主进程计算，渲染层只传协议全文与修订号；这里负责把同意记录
// 暂存到 localStorage（legal-evidence-pending），网络失败时留待下次启动补报。

export const PENDING_STORAGE_KEY = 'legal-evidence-pending'

// 生成一条待上报的同意记录；时间为 ISO-8601 本机时间字符串。
export function createPendingRecord({ revision, userAgreement, disclaimer } = {}, now = new Date()) {
  const recordedAt = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString()
  return {
    revision: typeof revision === 'string' ? revision : '',
    userAgreement: typeof userAgreement === 'string' ? userAgreement : '',
    disclaimer: typeof disclaimer === 'string' ? disclaimer : '',
    acceptedAt: recordedAt,
    clientRecordedAt: recordedAt
  }
}

export function serializePendingRecord(record) {
  return JSON.stringify(record)
}

// 从 localStorage 原文还原待补报记录；损坏或字段缺失时返回 null（视为没有待补报）。
export function parsePendingRecord(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (typeof parsed.revision !== 'string' || parsed.revision.trim() === '') return null
    if (typeof parsed.userAgreement !== 'string' || parsed.userAgreement === '') return null
    if (typeof parsed.disclaimer !== 'string' || parsed.disclaimer === '') return null
    return {
      revision: parsed.revision,
      userAgreement: parsed.userAgreement,
      disclaimer: parsed.disclaimer,
      acceptedAt: typeof parsed.acceptedAt === 'string' ? parsed.acceptedAt : null,
      clientRecordedAt: typeof parsed.clientRecordedAt === 'string' ? parsed.clientRecordedAt : null
    }
  } catch {
    return null
  }
}

// 发往主进程的 bridge 载荷；哈希由主进程按归档口径计算。
export function pendingRecordToReportPayload(record) {
  return {
    revision: record.revision,
    userAgreement: record.userAgreement,
    disclaimer: record.disclaimer,
    acceptedAt: record.acceptedAt,
    clientRecordedAt: record.clientRecordedAt
  }
}
