export const FREESTYLE_WORKSPACE_PRIMARY = 'primary' as const
export const FREESTYLE_WORKSPACE_SECONDARY = 'secondary' as const
export type FreestyleWorkspaceId = typeof FREESTYLE_WORKSPACE_PRIMARY | typeof FREESTYLE_WORKSPACE_SECONDARY

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
