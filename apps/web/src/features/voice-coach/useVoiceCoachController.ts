import * as React from 'react'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import type { AiRuntimeOptions } from '@/shared/api/contracts'
import {
  synthesizeVoiceCoachApi,
  type VoiceCoachEvent,
} from '@/features/voice-coach/api'
import {
  readVoiceCoachSettings,
  VOICE_COACH_SETTINGS_UPDATED_EVENT,
  type VoiceCoachSettings,
} from '@/entities/preferences/model/voiceCoachSettings'

export type VoiceCoachScene = 'review' | 'practice' | 'edit'

interface UseVoiceCoachControllerOptions {
  scene: VoiceCoachScene
  timer: TimedSessionController
  comboCount?: number
  progressPercent?: number
  allClearReady?: boolean
  completed?: boolean
  resolveAiOptions?: (request: {
    scenarioKey: string
    entrypointKey: string
    title: string
    description?: string
  }) => Promise<AiRuntimeOptions | undefined>
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
  resolveAiOptions,
}: UseVoiceCoachControllerOptions) {
  const [settings, setSettings] = React.useState<VoiceCoachSettings>(() =>
    readVoiceCoachSettings(),
  )
  const [activationTick, setActivationTick] = React.useState(0)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const urlCacheRef = React.useRef<Record<string, string>>({})
  const inFlightRef = React.useRef<Record<string, Promise<string>>>({})
  const onceKeysRef = React.useRef(new Set<string>())
  const lastEventAtRef = React.useRef<Partial<Record<VoiceCoachEvent, number>>>({})
  const userInteractedRef = React.useRef(false)
  const sessionAiOptionsRef = React.useRef<AiRuntimeOptions | undefined>(undefined)
  const sessionAiOptionsKeyRef = React.useRef('')

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

  React.useEffect(() => {
    sessionAiOptionsRef.current = undefined
    sessionAiOptionsKeyRef.current = ''
    urlCacheRef.current = {}
    inFlightRef.current = {}
  }, [scene, timer.startedAt])

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

  const resolveAudioUrl = React.useCallback(async (event: VoiceCoachEvent, aiOptions?: AiRuntimeOptions) => {
    const cacheKey = `${event}:${JSON.stringify(aiOptions ?? {})}`
    const cachedUrl = urlCacheRef.current[cacheKey]
    if (cachedUrl) return cachedUrl
    const inFlight = inFlightRef.current[cacheKey]
    if (inFlight) return inFlight

    const request = (aiOptions
      ? synthesizeVoiceCoachApi(event, aiOptions)
      : synthesizeVoiceCoachApi(event)
    ).then((response) => {
      urlCacheRef.current[cacheKey] = response.audio_url
      delete inFlightRef.current[cacheKey]
      return response.audio_url
    }).catch((error) => {
      delete inFlightRef.current[cacheKey]
      throw error
    })
    inFlightRef.current[cacheKey] = request
    return request
  }, [])

  const ensureSessionAiOptions = React.useCallback(async () => {
    if (!resolveAiOptions) return undefined
    const sessionKey = `${scene}:${timer.startedAt ?? 'manual'}`
    if (sessionAiOptionsKeyRef.current === sessionKey) {
      return sessionAiOptionsRef.current
    }
    const aiOptions = await resolveAiOptions({
      scenarioKey: 'tts_voice_coach',
      entrypointKey: `voice-coach:${scene}`,
      title: '语音教练配置',
      description: '本次会话会沿用这里的语音合成模型配置，后续自动触发不再重复询问。',
    })
    if (!aiOptions) {
      return null
    }
    sessionAiOptionsRef.current = aiOptions
    sessionAiOptionsKeyRef.current = sessionKey
    urlCacheRef.current = {}
    inFlightRef.current = {}
    return aiOptions
  }, [resolveAiOptions, scene, timer.startedAt])

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

      let aiOptions = sessionAiOptionsRef.current
      if (resolveAiOptions) {
        aiOptions = await ensureSessionAiOptions()
        if (aiOptions === null) {
          return false
        }
      }
      const audioUrl = await resolveAudioUrl(event, aiOptions)
      audioRef.current?.pause()
      const audio = new Audio(audioUrl)
      audio.volume = settings.volume
      audioRef.current = audio
      await audio.play()
      return true
    },
    [canPlay, ensureSessionAiOptions, resolveAiOptions, resolveAudioUrl, settings.cooldownSeconds, settings.volume],
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
