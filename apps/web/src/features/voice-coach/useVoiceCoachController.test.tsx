import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceCoachController } from '@/features/voice-coach/useVoiceCoachController'
import {
  DEFAULT_VOICE_COACH_SETTINGS,
  VOICE_COACH_SETTINGS_STORAGE_KEY,
} from '@/features/voice-coach/voiceCoachSettings'
import { synthesizeVoiceCoachApi } from '@/shared/api/modules/voiceCoach'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'

vi.mock('@/shared/api/modules/voiceCoach', () => ({
  synthesizeVoiceCoachApi: vi.fn(async (event: string) => ({
    ok: true,
    event,
    text: '',
    cache_key: 'cache-key',
    audio_url: '/api/v1/voice-coach/audio/cache-key',
    cached: true,
    model: 'cosyvoice-v3-flash',
    voice: 'longanyang',
    audio_format: 'mp3',
    sample_rate: 24000,
    request_id: '',
  })),
}))

function buildTimer(overrides: Partial<TimedSessionController> = {}): TimedSessionController {
  return {
    sessionId: 'timer-1',
    effectiveSeconds: 0,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'running',
    startedAt: null,
    durationEdited: false,
    glowState: 'idle',
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setSceneActive: vi.fn(),
    leaveScene: vi.fn(),
    registerActivity: vi.fn(),
    logEvent: vi.fn(),
    adjustDuration: vi.fn(),
    complete: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

function Harness({ timer }: { timer: TimedSessionController }) {
  useVoiceCoachController({
    scene: 'practice',
    timer,
  })
  return null
}

describe('useVoiceCoachController', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal(
      'Audio',
      vi.fn().mockImplementation(() => ({
        volume: 1,
        play: vi.fn(async () => undefined),
        pause: vi.fn(),
      })),
    )
  })

  it('does not request synthesis while disabled', async () => {
    render(<Harness timer={buildTimer({ idleSeconds: 120 })} />)

    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
    })

    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(synthesizeVoiceCoachApi).not.toHaveBeenCalled()
  })

  it('requests one idle nudge after the enabled threshold', async () => {
    window.localStorage.setItem(
      VOICE_COACH_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_VOICE_COACH_SETTINGS,
        enabled: true,
        idleNudgeSeconds: 75,
      }),
    )

    const { rerender } = render(<Harness timer={buildTimer({ idleSeconds: 75 })} />)

    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
    })

    await waitFor(() => {
      expect(synthesizeVoiceCoachApi).toHaveBeenCalledWith('idle_nudge')
    })

    rerender(<Harness timer={buildTimer({ idleSeconds: 76 })} />)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(synthesizeVoiceCoachApi).toHaveBeenCalledTimes(1)
  })
})
