import * as React from 'react'
import type { TimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import type { TimerFocusConfig } from '@/shared/components/session/timer-focus-config'
import type {
  BreakGuardAlertStrength,
  BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import type {
  BreakBooleanFieldKey,
  BreakNumberFieldKey,
  BreakTextFieldKey,
  FieldKey,
  FocusFieldKey,
} from '@/shared/components/session/timerAutomationDialogModel'
import {
  parseAutomationDraft,
  parseBreakDraft,
  parseFocusDraft,
  toBreakDraft,
  toDraft,
  toFocusDraft,
} from '@/shared/components/session/timerAutomationDialogModel'

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
  focusConfig,
  breakConfig,
}: {
  active: boolean
  config: TimerAutomationConfig
  focusConfig: TimerFocusConfig
  breakConfig: BreakGuardConfig
}) {
  const [draft, setDraft] = React.useState(() => toDraft(config))
  const [focusDraft, setFocusDraft] = React.useState(() => toFocusDraft(focusConfig))
  const [breakDraft, setBreakDraft] = React.useState(() => toBreakDraft(breakConfig))

  const resetDrafts = React.useCallback(() => {
    setDraft(toDraft(config))
    setFocusDraft(toFocusDraft(focusConfig))
    setBreakDraft(toBreakDraft(breakConfig))
  }, [breakConfig, config, focusConfig])

  React.useEffect(() => {
    if (!active) return
    resetDrafts()
  }, [active, resetDrafts])

  const handleFieldChange = React.useCallback((field: FieldKey, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }, [])

  const handleAutoStartChange = React.useCallback((checked: boolean) => {
    setDraft((current) => ({ ...current, autoStartOnPageEnter: checked }))
  }, [])

  const handleKeepScreenAwakeChange = React.useCallback((checked: boolean) => {
    setDraft((current) => ({ ...current, keepScreenAwake: checked }))
  }, [])

  const handleFocusFieldChange = React.useCallback((field: FocusFieldKey, value: string) => {
    setFocusDraft((current) => ({ ...current, [field]: value }))
  }, [])

  const handleBreakBooleanChange = React.useCallback((field: BreakBooleanFieldKey, checked: boolean) => {
    setBreakDraft((current) => ({
      ...current,
      [field]: checked,
    }))
  }, [])

  const handleBreakNumberChange = React.useCallback((field: BreakNumberFieldKey, value: string) => {
    setBreakDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }, [])

  const handleBreakTextChange = React.useCallback((field: BreakTextFieldKey, value: string) => {
    setBreakDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }, [])

  const handleBreakAlertStrengthChange = React.useCallback((value: BreakGuardAlertStrength) => {
    setBreakDraft((current) => ({
      ...current,
      alertStrength: value,
    }))
  }, [])

  const parsedConfig = React.useMemo(() => parseAutomationDraft(draft), [draft])
  const parsedFocusConfig = React.useMemo(() => parseFocusDraft(focusDraft), [focusDraft])
  const parsedBreakConfig = React.useMemo(() => parseBreakDraft(breakDraft), [breakDraft])

  // Compare parsed against saved rather than draft against draft: a draft holds
  // strings mid-edit ("05" vs 5) that must not register as a change.
  const isDirty = React.useMemo(
    () =>
      !isSameConfig(parsedConfig, config) ||
      !isSameConfig(parsedFocusConfig, focusConfig) ||
      !isSameConfig(parsedBreakConfig, breakConfig),
    [breakConfig, config, focusConfig, parsedBreakConfig, parsedConfig, parsedFocusConfig],
  )

  return {
    draft,
    focusDraft,
    breakDraft,
    setDraft,
    setFocusDraft,
    setBreakDraft,
    resetDrafts,
    isDirty,
    handleFieldChange,
    handleAutoStartChange,
    handleKeepScreenAwakeChange,
    handleFocusFieldChange,
    handleBreakBooleanChange,
    handleBreakNumberChange,
    handleBreakTextChange,
    handleBreakAlertStrengthChange,
    parsedConfig,
    parsedFocusConfig,
    parsedBreakConfig,
  }
}
