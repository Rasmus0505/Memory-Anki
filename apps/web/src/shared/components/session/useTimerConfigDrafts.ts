import * as React from 'react'
import type {
  TimerAutomationConfig,
  TimerAutomationMode,
  TimerAutomationScene,
} from '@/shared/components/session/timer-automation-config'
import type {
  TimerCelebrationVisualPreset,
  TimerFeedbackIntensity,
  TimerFocusConfig,
  TimerFocusMode,
  TimerFocusScene,
} from '@/shared/components/session/timer-focus-config'
import type {
  BreakGuardAlertStrength,
  BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import type {
  ActionFieldKey,
  BreakBooleanFieldKey,
  BreakNumberFieldKey,
  BreakTextFieldKey,
  CelebrationBooleanFieldKey,
  CelebrationEventKey,
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

export function useTimerConfigDrafts({
  open,
  config,
  focusConfig,
  breakConfig,
}: {
  open: boolean
  config: TimerAutomationConfig
  focusConfig: TimerFocusConfig
  breakConfig: BreakGuardConfig
}) {
  const [draft, setDraft] = React.useState(() => toDraft(config))
  const [focusDraft, setFocusDraft] = React.useState(() => toFocusDraft(focusConfig))
  const [breakDraft, setBreakDraft] = React.useState(() => toBreakDraft(breakConfig))

  React.useEffect(() => {
    if (!open) return
    setDraft(toDraft(config))
    setFocusDraft(toFocusDraft(focusConfig))
    setBreakDraft(toBreakDraft(breakConfig))
  }, [breakConfig, config, focusConfig, open])

  const handleModeChange = React.useCallback((mode: TimerAutomationMode) => {
    setDraft((current) => ({ ...current, mode }))
  }, [])

  const handleFieldChange = React.useCallback(
    (scene: 'shared' | TimerAutomationScene, field: FieldKey, value: string) => {
      setDraft((current) => ({
        ...current,
        [scene]: {
          ...current[scene],
          [field]: value,
        },
      }))
    },
    [],
  )

  const handleAutoStartChange = React.useCallback(
    (scene: 'shared' | TimerAutomationScene, checked: boolean) => {
      setDraft((current) => ({
        ...current,
        [scene]: {
          ...current[scene],
          autoStartOnPageEnter: checked,
        },
      }))
    },
    [],
  )

  const handleActionChange = React.useCallback((field: ActionFieldKey, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      actions: {
        ...current.actions,
        [field]: checked,
      },
    }))
  }, [])

  const handleFocusModeChange = React.useCallback((mode: TimerFocusMode) => {
    setFocusDraft((current) => ({ ...current, mode }))
  }, [])

  const handleFocusFieldChange = React.useCallback(
    (scene: 'global' | TimerFocusScene, field: FocusFieldKey, value: string) => {
      setFocusDraft((current) => ({
        ...current,
        [scene]: {
          ...current[scene],
          [field]: value,
        },
      }))
    },
    [],
  )

  const handleFeedbackIntensityChange = React.useCallback((value: TimerFeedbackIntensity) => {
    setFocusDraft((current) => ({
      ...current,
      feedbackIntensity: value,
    }))
  }, [])

  const handleCelebrationBooleanChange = React.useCallback((
    eventKey: CelebrationEventKey,
    field: CelebrationBooleanFieldKey,
    checked: boolean,
  ) => {
    setFocusDraft((current) => ({
      ...current,
      celebration: {
        ...current.celebration,
        [eventKey]: {
          ...current.celebration[eventKey],
          [field]: checked,
        },
      },
    }))
  }, [])

  const handleCelebrationVolumeChange = React.useCallback((eventKey: CelebrationEventKey, value: string) => {
    setFocusDraft((current) => ({
      ...current,
      celebration: {
        ...current.celebration,
        [eventKey]: {
          ...current.celebration[eventKey],
          volumeBoost: value,
        },
      },
    }))
  }, [])

  const handleCelebrationPresetChange = React.useCallback((
    eventKey: CelebrationEventKey,
    value: TimerCelebrationVisualPreset,
  ) => {
    setFocusDraft((current) => ({
      ...current,
      celebration: {
        ...current.celebration,
        [eventKey]: {
          ...current.celebration[eventKey],
          visualPreset: value,
        },
      },
    }))
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

  return {
    draft,
    focusDraft,
    breakDraft,
    setFocusDraft,
    setBreakDraft,
    handleModeChange,
    handleFieldChange,
    handleAutoStartChange,
    handleActionChange,
    handleFocusModeChange,
    handleFocusFieldChange,
    handleFeedbackIntensityChange,
    handleCelebrationBooleanChange,
    handleCelebrationVolumeChange,
    handleCelebrationPresetChange,
    handleBreakBooleanChange,
    handleBreakNumberChange,
    handleBreakTextChange,
    handleBreakAlertStrengthChange,
    parsedConfig,
    parsedFocusConfig,
    parsedBreakConfig,
  }
}
