const WORKSPACE_SESSION_KEY = 'memory-anki.page-history.workspace-id'
const WORKSPACE_CHANNEL = 'memory-anki.page-history.workspaces'
const instanceId = createWorkspaceId()

function createWorkspaceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function getPageHistoryWorkspaceId() {
  try {
    const existing = window.sessionStorage.getItem(WORKSPACE_SESSION_KEY)
    if (existing) return existing
    const created = createWorkspaceId()
    window.sessionStorage.setItem(WORKSPACE_SESSION_KEY, created)
    return created
  } catch {
    return createWorkspaceId()
  }
}

export function startPageHistoryWorkspaceHeartbeat(workspaceId: string) {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel(WORKSPACE_CHANNEL)
  let currentWorkspaceId = workspaceId
  const announce = () => channel.postMessage({
    type: 'heartbeat',
    workspaceId: currentWorkspaceId,
    instanceId,
    at: Date.now(),
  })
  const handleMessage = (event: MessageEvent<unknown>) => {
    const message = event.data as {
      type?: string
      workspaceId?: string
      instanceId?: string
    } | null
    if (
      message?.type !== 'heartbeat' ||
      message.workspaceId !== currentWorkspaceId ||
      !message.instanceId ||
      message.instanceId === instanceId ||
      instanceId < message.instanceId
    ) return
    currentWorkspaceId = createWorkspaceId()
    try {
      window.sessionStorage.setItem(WORKSPACE_SESSION_KEY, currentWorkspaceId)
    } catch {
      // Keep the in-memory workspace id when storage is unavailable.
    }
    announce()
  }
  channel.addEventListener('message', handleMessage)
  announce()
  const interval = window.setInterval(announce, 15_000)
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') announce()
  }
  document.addEventListener('visibilitychange', handleVisibility)
  return () => {
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', handleVisibility)
    channel.removeEventListener('message', handleMessage)
    channel.close()
  }
}
