import * as React from 'react'
import type { MindMapFeedbackEvent, MindMapFeedbackOrigin } from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  readReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/features/review/reviewFeedbackSettings'
import { getMindMapFeedbackProfile } from '@/shared/feedback/globalFeedbackModel'
import {
  getToneSpec,
  getComboMilestoneTone,
  type ToneSpec,
} from '@/shared/components/mindmap-host/toneProfiles'

interface MindMapFeedbackAudioController {
  playEvent: (event: MindMapFeedbackEvent, options?: { surprise?: boolean; origin?: MindMapFeedbackOrigin }) => void
  playComboMilestone: (milestoneStep: number) => void
}

/**
 * 二次调制：根据 origin（来源维度）微调 pan/gain/duration。
 * - node: 干净短促，pan 收窄 → "局部操作"听感
 * - review: 空间扩散，pan 放大 → "整体进展"听感
 * - system: 完整保留原始 profile → "系统级"听感
 * - 其他（keyboard/pointer/edge/toolbar）: 保持原值
 */
function tuneToneSpec(event: MindMapFeedbackEvent, tone: ToneSpec, origin?: MindMapFeedbackOrigin): ToneSpec {
  const level = getMindMapFeedbackProfile(event).level
  const gainScale = level === 'micro' ? 0.52 : level === 'action' ? 0.68 : 0.76
  const durationScale = level === 'micro' ? 0.72 : level === 'action' ? 0.82 : 0.9
  const durationCap = level === 'micro' ? 56 : level === 'action' ? 132 : 260

  let pan = tone.pan ?? 0
  let durationMul = 1
  let gainMul = 1

  if (origin === 'node') {
    // 局部操作：pan 收窄 60%，duration 缩短 10%
    pan = pan * 0.6
    durationMul = 0.9
  } else if (origin === 'review') {
    // 整体进展：pan 放大 30%，gain 增强 10%
    pan = pan * 1.3
    gainMul = 1.1
  }
  // system / keyboard / pointer / edge / toolbar → 保持原值

  return {
    ...tone,
    pan: Math.max(-1, Math.min(1, pan)),
    durationMs: Math.max(18, Math.round(Math.min(durationCap, tone.durationMs * durationScale * durationMul))),
    gain: tone.gain * gainScale * gainMul,
  }
}

function shouldPlayNoiseBurst(event: MindMapFeedbackEvent) {
  return (
    event === 'node_delete' ||
    event === 'save_error' ||
    event === 'import_apply' ||
    event === 'card_reveal' ||
    event === 'branch_clear' ||
    event === 'all_clear_ready' ||
    event === 'session_complete'
  )
}

function clampFeedbackVolume(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(2, value))
}

const FEEDBACK_BASE_GAIN_MULTIPLIER = 8

export function useMindMapFeedbackAudio(
  enabled: boolean,
  volume = 1,
): MindMapFeedbackAudioController {
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const feedbackVolume = clampFeedbackVolume(volume)
  const feedbackGain = feedbackVolume * FEEDBACK_BASE_GAIN_MULTIPLIER

  React.useEffect(() => {
    return () => {
      const audioContext = audioContextRef.current
      audioContextRef.current = null
      void audioContext?.close().catch(() => undefined)
    }
  }, [])

  const playEvent = React.useCallback(
    (event: MindMapFeedbackEvent, options?: { surprise?: boolean; origin?: MindMapFeedbackOrigin }) => {
      if (!enabled || feedbackVolume <= 0 || typeof window === 'undefined') return
      if (
        'userActivation' in window.navigator &&
        window.navigator.userActivation &&
        !window.navigator.userActivation.hasBeenActive
      ) {
        return
      }
      const AudioContextCtor =
        window.AudioContext ||
        // @ts-expect-error WebKit fallback
        window.webkitAudioContext
      if (!AudioContextCtor) return

      try {
        const audioContext =
          audioContextRef.current && audioContextRef.current.state !== 'closed'
            ? audioContextRef.current
            : new AudioContextCtor()
        audioContextRef.current = audioContext

        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => undefined)
        }

        const origin = options?.origin
        const now = audioContext.currentTime
        for (const tone of getToneSpec(event, Boolean(options?.surprise)).map((item) =>
          tuneToneSpec(event, item, origin),
        )) {
          const oscillator = audioContext.createOscillator()
          const gainNode = audioContext.createGain()
          const panNode =
            typeof audioContext.createStereoPanner === 'function'
              ? audioContext.createStereoPanner()
              : null
          const startAt = now + tone.offsetMs / 1000
          const endAt = now + (tone.offsetMs + tone.durationMs) / 1000
          oscillator.type = tone.type
          oscillator.frequency.setValueAtTime(tone.frequency, startAt)
          if (tone.endFrequency) {
            oscillator.frequency.exponentialRampToValueAtTime(
              Math.max(1, tone.endFrequency),
              endAt,
            )
          }
          if (panNode && typeof tone.pan === 'number') {
            panNode.pan.setValueAtTime(Math.max(-1, Math.min(1, tone.pan)), startAt)
          }
          const attackSeconds = (tone.attackMs ?? 10) / 1000
          gainNode.gain.setValueAtTime(0.0001, startAt)
          gainNode.gain.linearRampToValueAtTime(
            tone.gain * feedbackGain,
            startAt + attackSeconds,
          )
          gainNode.gain.exponentialRampToValueAtTime(
            0.0001,
            endAt,
          )
          oscillator.connect(gainNode)
          if (panNode) {
            gainNode.connect(panNode)
            panNode.connect(audioContext.destination)
          } else {
            gainNode.connect(audioContext.destination)
          }
          oscillator.start(startAt)
          oscillator.stop(endAt + 0.02)
        }

        if (shouldPlayNoiseBurst(event)) {
          const sampleRate = audioContext.sampleRate
          const durationSeconds =
            event === 'session_complete' || event === 'all_clear_ready'
              ? 0.055
              : 0.032
          const buffer = audioContext.createBuffer(1, Math.max(1, Math.floor(sampleRate * durationSeconds)), sampleRate)
          const data = buffer.getChannelData(0)
          for (let index = 0; index < data.length; index += 1) {
            const fade = 1 - index / data.length
            data[index] = (Math.random() * 2 - 1) * fade * 0.34
          }
          const source = audioContext.createBufferSource()
          const gainNode = audioContext.createGain()
          const filterNode = audioContext.createBiquadFilter()
          const panNode =
            typeof audioContext.createStereoPanner === 'function'
              ? audioContext.createStereoPanner()
              : null
          filterNode.type = event === 'node_delete' || event === 'save_error' ? 'lowpass' : 'highpass'
          filterNode.frequency.setValueAtTime(
            event === 'node_delete' || event === 'save_error' ? 760 : 2200,
            now,
          )
          gainNode.gain.setValueAtTime(0.011 * feedbackGain, now)
          gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)
          if (panNode) {
            panNode.pan.setValueAtTime(0, now)
          }
          source.buffer = buffer
          source.connect(filterNode)
          filterNode.connect(gainNode)
          if (panNode) {
            gainNode.connect(panNode)
            panNode.connect(audioContext.destination)
          } else {
            gainNode.connect(audioContext.destination)
          }
          source.start(now)
          source.stop(now + durationSeconds + 0.01)
        }
      } catch {
        // Feedback audio is optional; visual feedback remains active.
      }
    },
    [enabled, feedbackGain, feedbackVolume],
  )

  const playComboMilestone = React.useCallback(
    (milestoneStep: number) => {
      if (!enabled || feedbackVolume <= 0 || typeof window === 'undefined') return
      if (
        'userActivation' in window.navigator &&
        window.navigator.userActivation &&
        !window.navigator.userActivation.hasBeenActive
      ) {
        return
      }
      const AudioContextCtor =
        window.AudioContext ||
        // @ts-expect-error WebKit fallback
        window.webkitAudioContext
      if (!AudioContextCtor) return

      try {
        const audioContext =
          audioContextRef.current && audioContextRef.current.state !== 'closed'
            ? audioContextRef.current
            : new AudioContextCtor()
        audioContextRef.current = audioContext

        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => undefined)
        }

        const now = audioContext.currentTime
        for (const tone of getComboMilestoneTone(milestoneStep)) {
          const oscillator = audioContext.createOscillator()
          const gainNode = audioContext.createGain()
          const panNode =
            typeof audioContext.createStereoPanner === 'function'
              ? audioContext.createStereoPanner()
              : null
          const startAt = now + tone.offsetMs / 1000
          const endAt = now + (tone.offsetMs + tone.durationMs) / 1000
          oscillator.type = tone.type
          oscillator.frequency.setValueAtTime(tone.frequency, startAt)
          if (tone.endFrequency) {
            oscillator.frequency.exponentialRampToValueAtTime(
              Math.max(1, tone.endFrequency),
              endAt,
            )
          }
          if (panNode && typeof tone.pan === 'number') {
            panNode.pan.setValueAtTime(Math.max(-1, Math.min(1, tone.pan)), startAt)
          }
          const attackSeconds = (tone.attackMs ?? 10) / 1000
          gainNode.gain.setValueAtTime(0.0001, startAt)
          gainNode.gain.linearRampToValueAtTime(
            tone.gain * feedbackGain,
            startAt + attackSeconds,
          )
          gainNode.gain.exponentialRampToValueAtTime(
            0.0001,
            endAt,
          )
          oscillator.connect(gainNode)
          if (panNode) {
            gainNode.connect(panNode)
            panNode.connect(audioContext.destination)
          } else {
            gainNode.connect(audioContext.destination)
          }
          oscillator.start(startAt)
          oscillator.stop(endAt + 0.02)
        }
      } catch {
        // Feedback audio is optional; visual feedback remains active.
      }
    },
    [enabled, feedbackGain, feedbackVolume],
  )

  return { playEvent, playComboMilestone }
}

export function useMindMapFeedbackSettings() {
  const [settings, setSettings] = React.useState<ReviewFeedbackSettings>(() =>
    readReviewFeedbackSettings(),
  )

  React.useEffect(() => {
    const sync = () => setSettings(readReviewFeedbackSettings())
    window.addEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  return settings
}

export function useMindMapFeedbackAudioFromSettings() {
  const settings = useMindMapFeedbackSettings()
  return useMindMapFeedbackAudio(
    settings.soundEnabled && settings.mode === 'immersive',
    settings.volume,
  )
}
