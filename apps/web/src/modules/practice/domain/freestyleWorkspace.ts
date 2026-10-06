export const FREESTYLE_WORKSPACE_PRIMARY = 'primary' as const
export const FREESTYLE_WORKSPACE_SECONDARY = 'secondary' as const
export type FreestyleWorkspaceId = typeof FREESTYLE_WORKSPACE_PRIMARY | typeof FREESTYLE_WORKSPACE_SECONDARY
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

export function normalizeFreestyleWorkspaceId(value: unknown): FreestyleWorkspaceId {
  return value === FREESTYLE_WORKSPACE_SECONDARY ? FREESTYLE_WORKSPACE_SECONDARY : FREESTYLE_WORKSPACE_PRIMARY
}

export function freestyleWorkspacePath(workspace: FreestyleWorkspaceId): string {
  return workspace === FREESTYLE_WORKSPACE_SECONDARY ? '/freestyle-2' : '/freestyle'
}

export function freestyleWorkspaceLabel(workspace: FreestyleWorkspaceId): string {
  return workspace === FREESTYLE_WORKSPACE_SECONDARY ? '随心 2' : '随心'
}

export function peerFreestyleWorkspace(workspace: FreestyleWorkspaceId): FreestyleWorkspaceId {
  return workspace === FREESTYLE_WORKSPACE_PRIMARY ? FREESTYLE_WORKSPACE_SECONDARY : FREESTYLE_WORKSPACE_PRIMARY
}
