export const FREESTYLE_WORKSPACE_PRIMARY = 'primary' as const
/** 随心 is the single immersive workspace (随心 2 was merged in by migration 0072). */
export type FreestyleWorkspaceId = typeof FREESTYLE_WORKSPACE_PRIMARY
/** `p` + palace id. Matches the backend column width (String(20)). */
export type PalaceReviewWorkspaceId = `p${number}`

const PALACE_REVIEW_WORKSPACE_RE = /^p[1-9]\d{0,18}$/

export function isPalaceReviewWorkspace(value: unknown): value is PalaceReviewWorkspaceId {
  return typeof value === 'string' && PALACE_REVIEW_WORKSPACE_RE.test(value)
}

export function palaceReviewWorkspaceId(palaceId: number): PalaceReviewWorkspaceId {
  if (!Number.isSafeInteger(palaceId) || palaceId <= 0) {
    throw new Error('palace review workspace id is invalid')
  }
  const text = `p${palaceId}`
  if (!isPalaceReviewWorkspace(text)) {
    throw new Error('palace review workspace id is invalid')
  }
  return text
}

export function parsePalaceReviewWorkspaceId(value: unknown): number | null {
  if (!isPalaceReviewWorkspace(value)) return null
  const palaceId = Number(value.slice(1))
  return Number.isSafeInteger(palaceId) && palaceId > 0 ? palaceId : null
}

export function palaceReviewPath(palaceId: number, subjectId?: string | null): string {
  const path = `/palaces/${palaceId}/review`
  return subjectId && /^\d+$/.test(subjectId) ? `${path}?subjectId=${subjectId}` : path
}

export function normalizeFreestyleWorkspaceId(_value: unknown): FreestyleWorkspaceId {
  return FREESTYLE_WORKSPACE_PRIMARY
}

export function freestyleWorkspacePath(_workspace: FreestyleWorkspaceId): string {
  return '/freestyle'
}

export function freestyleWorkspaceLabel(_workspace: FreestyleWorkspaceId): string {
  return '随心'
}
