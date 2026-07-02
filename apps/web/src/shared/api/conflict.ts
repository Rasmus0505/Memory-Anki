const CONFLICT_MESSAGE_PATTERN = /冲突|fingerprint|stale|旧态|危险结构|覆盖当前/

export function isConflictResponse(status: number, message = '') {
  return status === 409 || CONFLICT_MESSAGE_PATTERN.test(message)
}
