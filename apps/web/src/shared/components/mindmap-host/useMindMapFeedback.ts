import * as React from 'react'
import type { MindMapFeedbackEvent } from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  readReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/features/review/reviewFeedbackSettings'
import { getMindMapFeedbackProfile } from '@/shared/feedback/globalFeedbackModel'

interface MindMapFeedbackAudioController {
  playEvent: (event: MindMapFeedbackEvent, options?: { surprise?: boolean }) => void
}

interface ToneSpec {
  frequency: number
  durationMs: number
  gain: number
  type: OscillatorType
  offsetMs: number
  endFrequency?: number
  pan?: number
  attackMs?: number
}

function tuneToneSpec(event: MindMapFeedbackEvent, tone: ToneSpec): ToneSpec {
  const level = getMindMapFeedbackProfile(event).level
  const gainScale = level === 'micro' ? 0.52 : level === 'action' ? 0.68 : 0.76
  const durationScale = level === 'micro' ? 0.72 : level === 'action' ? 0.82 : 0.9
  const durationCap = level === 'micro' ? 56 : level === 'action' ? 132 : 260
  return {
    ...tone,
    durationMs: Math.max(18, Math.round(Math.min(durationCap, tone.durationMs * durationScale))),
    gain: tone.gain * gainScale,
  }
}

function createToneSpec(event: MindMapFeedbackEvent, surprise: boolean): ToneSpec[] {
  if (event === 'hover_pulse') {
    return [{ frequency: 420, endFrequency: 520, durationMs: 28, gain: 0.008, type: 'sine', offsetMs: 0, pan: 0.12, attackMs: 3 }]
  }
  if (event === 'pointer_down') {
    return [{ frequency: 160, endFrequency: 205, durationMs: 26, gain: 0.01, type: 'sine', offsetMs: 0, pan: -0.08 }]
  }
  if (event === 'pointer_click') {
    return [
      { frequency: 260, endFrequency: 320, durationMs: 28, gain: 0.012, type: 'sine', offsetMs: 0, pan: -0.04 },
      { frequency: 390, durationMs: 24, gain: 0.007, type: 'sine', offsetMs: 22, pan: 0.04 },
    ]
  }
  if (event === 'key_press') {
    return [{ frequency: 560, endFrequency: 500, durationMs: 16, gain: 0.0055, type: 'sine', offsetMs: 0, pan: 0.06, attackMs: 3 }]
  }
  if (event === 'shortcut_trigger') {
    return [
      { frequency: 392, durationMs: 54, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.14 },
      { frequency: 587, durationMs: 72, gain: 0.024, type: 'sine', offsetMs: 44, pan: 0 },
      { frequency: 784, durationMs: 94, gain: 0.02, type: 'triangle', offsetMs: 94, pan: 0.14 },
    ]
  }
  if (event === 'navigation') {
    return [
      { frequency: 330, endFrequency: 440, durationMs: 86, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.18 },
      { frequency: 660, durationMs: 96, gain: 0.024, type: 'sine', offsetMs: 52, pan: 0.18 },
    ]
  }
  if (event === 'field_focus') {
    return [
      { frequency: 280, endFrequency: 360, durationMs: 52, gain: 0.016, type: 'sine', offsetMs: 0, pan: -0.08 },
      { frequency: 460, durationMs: 66, gain: 0.012, type: 'triangle', offsetMs: 28, pan: 0.08 },
    ]
  }
  if (event === 'field_commit') {
    return [
      { frequency: 392, durationMs: 62, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.08 },
      { frequency: 523, durationMs: 72, gain: 0.022, type: 'sine', offsetMs: 40, pan: 0.08 },
      { frequency: 698, durationMs: 92, gain: 0.016, type: 'triangle', offsetMs: 92, pan: 0 },
    ]
  }
  if (event === 'toggle_on' || event === 'toggle_off') {
    return event === 'toggle_on'
      ? [
          { frequency: 370, durationMs: 48, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.12 },
          { frequency: 555, durationMs: 72, gain: 0.022, type: 'sine', offsetMs: 34, pan: 0.12 },
        ]
      : [
          { frequency: 420, durationMs: 44, gain: 0.022, type: 'triangle', offsetMs: 0, pan: 0.12 },
          { frequency: 280, durationMs: 76, gain: 0.018, type: 'sine', offsetMs: 28, pan: -0.12 },
        ]
  }
  if (event === 'node_select') {
    return [{ frequency: 340, endFrequency: 390, durationMs: 30, gain: 0.011, type: 'sine', offsetMs: 0, pan: -0.05 }]
  }
  if (event === 'node_edit_start') {
    return [
      { frequency: 300, endFrequency: 390, durationMs: 54, gain: 0.018, type: 'triangle', offsetMs: 0, pan: -0.14 },
      { frequency: 560, durationMs: 64, gain: 0.011, type: 'sine', offsetMs: 34, pan: 0.14 },
    ]
  }
  if (event === 'text_commit' || event === 'save_success') {
    return [
      { frequency: 390, durationMs: 46, gain: 0.017, type: 'triangle', offsetMs: 0, pan: -0.08 },
      { frequency: 520, durationMs: 56, gain: 0.013, type: 'sine', offsetMs: 34, pan: 0.08 },
    ]
  }
  if (event === 'node_create') {
    return [
      { frequency: 360, endFrequency: 480, durationMs: 62, gain: 0.02, type: 'triangle', offsetMs: 0, pan: -0.12 },
      { frequency: 640, durationMs: 72, gain: 0.014, type: 'sine', offsetMs: 48, pan: 0.12 },
    ]
  }
  if (event === 'import_apply') {
    return [
      { frequency: 294, endFrequency: 392, durationMs: 110, gain: 0.032, type: 'triangle', offsetMs: 0, pan: -0.24 },
      { frequency: 587, durationMs: 128, gain: 0.028, type: 'sine', offsetMs: 76, pan: 0 },
      { frequency: 880, durationMs: 150, gain: 0.022, type: 'triangle', offsetMs: 148, pan: 0.24 },
    ]
  }
  if (event === 'bilink_action') {
    return [
      { frequency: 523, durationMs: 58, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.28 },
      { frequency: 523, durationMs: 58, gain: 0.024, type: 'triangle', offsetMs: 72, pan: 0.28 },
      { frequency: 784, durationMs: 98, gain: 0.02, type: 'sine', offsetMs: 136, pan: 0 },
    ]
  }
  if (event === 'segment_action') {
    return [
      { frequency: 349, durationMs: 58, gain: 0.028, type: 'triangle', offsetMs: 0, pan: -0.08 },
      { frequency: 466, durationMs: 58, gain: 0.026, type: 'triangle', offsetMs: 62, pan: 0.08 },
      { frequency: 622, durationMs: 82, gain: 0.022, type: 'sine', offsetMs: 124, pan: 0 },
    ]
  }
  if (event === 'node_delete' || event === 'save_error') {
    return [
      { frequency: 320, endFrequency: 190, durationMs: 96, gain: 0.032, type: 'sawtooth', offsetMs: 0, pan: 0.18 },
      { frequency: 160, durationMs: 118, gain: 0.026, type: 'triangle', offsetMs: 72, pan: -0.14 },
    ]
  }
  if (event === 'node_move') {
    return [
      { frequency: 280, endFrequency: 420, durationMs: 116, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.26 },
      { frequency: 420, endFrequency: 520, durationMs: 92, gain: 0.018, type: 'sine', offsetMs: 74, pan: 0.26 },
    ]
  }
  if (event === 'drag_start') {
    return [{ frequency: 220, endFrequency: 360, durationMs: 96, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.3 }]
  }
  if (event === 'drag_drop') {
    return [
      { frequency: 300, endFrequency: 390, durationMs: 50, gain: 0.018, type: 'triangle', offsetMs: 0, pan: 0.1 },
      { frequency: 500, durationMs: 58, gain: 0.012, type: 'sine', offsetMs: 36, pan: -0.1 },
    ]
  }
  if (event === 'context_menu') {
    return [
      { frequency: 196, durationMs: 82, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.2 },
      { frequency: 247, durationMs: 58, gain: 0.018, type: 'sine', offsetMs: 52, pan: 0.2 },
    ]
  }
  if (event === 'toolbar_action') {
    return [
      { frequency: 370, durationMs: 50, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.08 },
      { frequency: 555, durationMs: 62, gain: 0.022, type: 'sine', offsetMs: 38, pan: 0.08 },
    ]
  }
  if (event === 'mode_switch') {
    return [
      { frequency: 262, endFrequency: 392, durationMs: 126, gain: 0.028, type: 'triangle', offsetMs: 0, pan: -0.22 },
      { frequency: 523, endFrequency: 784, durationMs: 142, gain: 0.022, type: 'sine', offsetMs: 82, pan: 0.22 },
    ]
  }
  if (event === 'category_expand' || event === 'next_level_expand') {
    return [
      { frequency: 494, endFrequency: 659, durationMs: 92, gain: 0.04, type: 'triangle', offsetMs: 0, pan: -0.14 },
      { frequency: 740, durationMs: 104, gain: 0.028, type: 'sine', offsetMs: 66, pan: 0.16 },
    ]
  }
  if (event === 'card_reveal') {
    return surprise
      ? [
          { frequency: 520, durationMs: 120, gain: 0.06, type: 'triangle', offsetMs: 0, pan: -0.22 },
          { frequency: 780, durationMs: 150, gain: 0.05, type: 'sine', offsetMs: 65, pan: 0 },
          { frequency: 1046, durationMs: 180, gain: 0.03, type: 'triangle', offsetMs: 150, pan: 0.22 },
        ]
      : [
          { frequency: 540, durationMs: 104, gain: 0.044, type: 'triangle', offsetMs: 0, pan: -0.12 },
          { frequency: 810, durationMs: 82, gain: 0.024, type: 'sine', offsetMs: 72, pan: 0.12 },
        ]
  }
  if (event === 'branch_clear') {
    return [
      { frequency: 392, durationMs: 132, gain: 0.044, type: 'triangle', offsetMs: 0, pan: -0.24 },
      { frequency: 587, durationMs: 160, gain: 0.04, type: 'sine', offsetMs: 72, pan: 0 },
      { frequency: 880, durationMs: 190, gain: 0.028, type: 'triangle', offsetMs: 158, pan: 0.24 },
    ]
  }
  if (event === 'all_clear_ready') {
    return [
      { frequency: 392, durationMs: 156, gain: 0.046, type: 'triangle', offsetMs: 0, pan: -0.28 },
      { frequency: 587, durationMs: 188, gain: 0.042, type: 'sine', offsetMs: 86, pan: 0 },
      { frequency: 988, durationMs: 230, gain: 0.034, type: 'triangle', offsetMs: 188, pan: 0.28 },
    ]
  }
  if (event === 'session_complete') {
    return [
      { frequency: 262, durationMs: 190, gain: 0.04, type: 'triangle', offsetMs: 0, pan: -0.3 },
      { frequency: 392, durationMs: 210, gain: 0.044, type: 'sine', offsetMs: 120, pan: -0.1 },
      { frequency: 523, durationMs: 250, gain: 0.046, type: 'triangle', offsetMs: 250, pan: 0.1 },
      { frequency: 784, durationMs: 330, gain: 0.04, type: 'sine', offsetMs: 430, pan: 0.3 },
    ]
  }
  return [{ frequency: 260, durationMs: 90, gain: 0.03, type: 'triangle', offsetMs: 0 }]
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
    (event: MindMapFeedbackEvent, options?: { surprise?: boolean }) => {
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
        for (const tone of createToneSpec(event, Boolean(options?.surprise)).map((item) =>
          tuneToneSpec(event, item),
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

  return { playEvent }
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
