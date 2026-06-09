import * as React from 'react'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import {
  synthesizeVoiceCoachApi,
  type VoiceCoachEvent,
} from '@/shared/api/modules/voiceCoach'
import {
  readVoiceCoachSettings,
  VOICE_COACH_SETTINGS_UPDATED_EVENT,
  type VoiceCoachSettings,
} from '@/features/voice-coach/voiceCoachSettings'

export type VoiceCoachScene = 'review' | 'practice' | 'edit'

interface UseVoiceCoachControllerOptions {
  scene: VoiceCoachScene
  timer: TimedSessionController
  comboCount?: number
  progressPercent?: number
  allClearReady?: boolean
  completed?: boolean
}

interface PlayOptions {
  force?: boolean
  ignoreEnabled?: boolean
  ignoreTimer?: boolean
  onceKey?: string
}

function browserHasUserActivation() {
  if (typeof window === 'undefined') return false
  const navigatorWithActivation = window.navigator as Navigator & {
    userActivation?: { hasBeenActive?: boolean }
  }
  return Boolean(navigatorWithActivation.userActivation?.hasBeenActive)
}

export function useVoiceCoachController({
  scene,
  timer,
  comboCount = 0,
  progressPercent = 0,
  allClearReady = false,
  completed = false,
}: UseVoiceCoachControllerOptions) {
  const [settings, setSettings] = React.useState<VoiceCoachSettings>(() =>
    readVoiceCoachSettings(),
  )
  const [activationTick, setActivationTick] = React.useState(0)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const urlCacheRef = React.useRef<Partial<Record<VoiceCoachEvent, string>>>({})
  const inFlightRef = React.useRef<Partial<Record<VoiceCoachEvent, Promise<string>>>>({})
  const onceKeysRef = React.useRef(new Set<string>())
  const lastEventAtRef = React.useRef<Partial<Record<VoiceCoachEvent, number>>>({})
  const userInteractedRef = React.useRef(false)

  React.useEffect(() => {
    const sync = () => setSettings(readVoiceCoachSettings())
    window.addEventListener(VOICE_COACH_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(VOICE_COACH_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  React.useEffect(() => {
    const markInteracted = () => {
      if (!userInteractedRef.current) {
        userInteractedRef.current = true
      }
      setActivationTick((value) => value + 1)
    }
    window.addEventListener('pointerdown', markInteracted, true)
    window.addEventListener('keydown', markInteracted, true)
    return () => {
      window.removeEventListener('pointerdown', markInteracted, true)
      window.removeEventListener('keydown', markInteracted, true)
    }
  }, [])

  React.useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const canPlay = React.useCallback(
    (options: PlayOptions) => {
      if (!options.ignoreEnabled) {
        if (!settings.enabled) return false
        if (!settings.scenes[scene]) return false
      }
      if (!options.ignoreTimer && timer.status !== 'running') return false
      if (!userInteractedRef.current && !browserHasUserActivation()) return false
      return true
    },
    [scene, settings.enabled, settings.scenes, timer.status],
  )

  const resolveAudioUrl = React.useCallback(async (event: VoiceCoachEvent) => {
    const cachedUrl = urlCacheRef.current[event]
    if (cachedUrl) return cachedUrl
    const inFlight = inFlightRef.current[event]
    if (inFlight) return inFlight

    const request = synthesizeVoiceCoachApi(event).then((response) => {
      urlCacheRef.current[event] = response.audio_url
      delete inFlightRef.current[event]
      return response.audio_url
    }).catch((error) => {
      delete inFlightRef.current[event]
      throw error
    })
    inFlightRef.current[event] = request
    return request
  }, [])

  const playEvent = React.useCallback(
    async (event: VoiceCoachEvent, options: PlayOptions = {}) => {
      if (!canPlay(options)) return false
      if (options.onceKey && onceKeysRef.current.has(options.onceKey)) return false

      const now = Date.now()
      const cooldownMs = Math.max(0, settings.cooldownSeconds * 1000)
      const lastEventAt = lastEventAtRef.current[event] ?? 0
      if (!options.force && now - lastEventAt < cooldownMs) return false

      if (options.onceKey) {
        onceKeysRef.current.add(options.onceKey)
      }
      lastEventAtRef.current[event] = now

      const audioUrl = await resolveAudioUrl(event)
      audioRef.current?.pause()
      const audio = new Audio(audioUrl)
      audio.volume = settings.volume
      audioRef.current = audio
      await audio.play()
      return true
    },
    [canPlay, resolveAudioUrl, settings.cooldownSeconds, settings.volume],
  )

  const playTestEvent = React.useCallback(
    (event: VoiceCoachEvent = 'session_start') =>
      playEvent(event, {
        force: true,
        ignoreEnabled: true,
        ignoreTimer: true,
      }),
    [playEvent],
  )

  React.useEffect(() => {
    if (!timer.startedAt || completed) return
    void playEvent('session_start', {
      onceKey: `session_start:${scene}:${timer.startedAt}`,
    }).catch(() => undefined)
  }, [activationTick, completed, playEvent, scene, timer.startedAt, timer.status])

  React.useEffect(() => {
    if (completed) return
    const threshold =
      scene === 'edit' ? settings.editIdleNudgeSeconds : settings.idleNudgeSeconds
    if (timer.idleSeconds < threshold) return
    const event: VoiceCoachEvent = scene === 'edit' ? 'edit_idle_nudge' : 'idle_nudge'
    void playEvent(event).catch(() => undefined)
  }, [
    activationTick,
    completed,
    playEvent,
    scene,
    settings.editIdleNudgeSeconds,
    settings.idleNudgeSeconds,
    timer.idleSeconds,
  ])

  React.useEffect(() => {
    if (scene === 'edit' || completed || !settings.milestoneEnabled) return
    if (comboCount < 5 && progressPercent < 50) return
    void playEvent('milestone', {
      onceKey: `milestone:${scene}:${timer.startedAt ?? 'unstarted'}`,
    }).catch(() => undefined)
  }, [
    comboCount,
    completed,
    playEvent,
    progressPercent,
    scene,
    settings.milestoneEnabled,
    timer.startedAt,
  ])

  React.useEffect(() => {
    if (scene === 'edit' || completed || !allClearReady) return
    void playEvent('all_clear_ready', {
      onceKey: `all_clear_ready:${scene}:${timer.startedAt ?? 'unstarted'}`,
    }).catch(() => undefined)
  }, [allClearReady, completed, playEvent, scene, timer.startedAt])

  React.useEffect(() => {
    if (!completed || !settings.completionEnabled) return
    void playEvent('session_complete', {
      onceKey: `session_complete:${scene}:${timer.startedAt ?? 'unstarted'}`,
    }).catch(() => undefined)
  }, [completed, playEvent, scene, settings.completionEnabled, timer.startedAt])

  return {
    settings,
    enabled: settings.enabled && settings.scenes[scene],
    playEvent,
    playTestEvent,
  }
}
