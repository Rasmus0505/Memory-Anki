import type { WorkspaceTab } from './ai-workspace'

export type AiTab = 'access' | 'models' | 'scenes' | 'blocks' | 'observability'

export const AI_TABS: ReadonlyArray<{ key: AiTab; label: string }> = [
  { key: 'access', label: '接入' },
  { key: 'models', label: '模型' },
  { key: 'scenes', label: '场景' },
  { key: 'blocks', label: '提示词块' },
  { key: 'observability', label: '观测' },
]

export function resolveAiTab(params: URLSearchParams): AiTab {
  const tab = params.get('tab')
  if (tab === 'access' || tab === 'models' || tab === 'scenes' || tab === 'blocks' || tab === 'observability') {
    return tab
  }
  return 'access'
}

export function workspaceTabToAiTab(value: string | null): AiTab {
  if (value === 'models') return 'models'
  if (value === 'scenes') return 'scenes'
  if (value === 'observability' || value === 'quality') return 'observability'
  return 'access'
}

export function aiTabToWorkspaceTab(tab: Exclude<AiTab, 'blocks'>): WorkspaceTab {
  if (tab === 'access') return 'providers'
  return tab
}

export function normalizeAiSearchParams(params: URLSearchParams, tab: AiTab) {
  const next = new URLSearchParams(params)
  next.set('tab', tab)
  next.delete('aiTab')
  return next
}
