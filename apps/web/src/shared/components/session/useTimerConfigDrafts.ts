import * as React from 'react'
import type { TimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { parseAutomationDraft, toDraft } from '@/shared/components/session/timerAutomationDialogModel'

/**
 * Order-insensitive comparison. A plain JSON.stringify would report a change
 * whenever a default and its sanitizer happen to list keys in a different
 * order, which shows up as a settings page that is dirty the moment it opens.
 */
function isSameConfig(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => isSameConfig(item, right[index]))
  }
  const leftKeys = Object.keys(left as Record<string, unknown>).sort()
  const rightKeys = Object.keys(right as Record<string, unknown>).sort()
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      isSameConfig(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  )
}

/**
 * Shared draft state for the timer settings page and the in-session dialog.
 *
 * `active` is `open` for the dialog and a constant `true` for the page, so both
 * surfaces edit the same drafts through the same handlers.
 */
export function useTimerConfigDrafts({
  active,
  config,
}: {
  active: boolean
  config: TimerAutomationConfig
}) {
  const [draft, setDraft] = React.useState(() => toDraft(config))

  const resetDrafts = React.useCallback(() => {
    setDraft(toDraft(config))
  }, [config])

  React.useEffect(() => {
    if (!active) return
    resetDrafts()
  }, [active, resetDrafts])

  const handleAutoStartChange = React.useCallback((checked: boolean) => {
    setDraft((current) => ({ ...current, autoStartOnPageEnter: checked }))
  }, [])

  const handleKeepScreenAwakeChange = React.useCallback((checked: boolean) => {
    setDraft((current) => ({ ...current, keepScreenAwake: checked }))
  }, [])

  const parsedConfig = React.useMemo(() => parseAutomationDraft(draft), [draft])

  // Compare parsed against saved rather than draft against draft: a draft holds
  // strings mid-edit ("05" vs 5) that must not register as a change.
  const isDirty = React.useMemo(
    () => !isSameConfig(parsedConfig, config),
    [config, parsedConfig],
  )

  return {
    draft,
    setDraft,
    resetDrafts,
    isDirty,
    handleAutoStartChange,
    handleKeepScreenAwakeChange,
    parsedConfig,
  }
}
