import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ListenerEntry = {
  listener: EventListenerOrEventListenerObject
  options?: AddEventListenerOptions | boolean
}

interface MockOscillator {
  connect: ReturnType<typeof vi.fn>
  frequency: {
    setValueAtTime: ReturnType<typeof vi.fn>
    linearRampToValueAtTime: ReturnType<typeof vi.fn>
  }
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  type: OscillatorType
}

class MockAudioContext {
  static instances: MockAudioContext[] = []
  static oscillators: MockOscillator[] = []

  currentTime = 0
  destination = {}
  state: AudioContextState = 'suspended'
  resume = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })

  constructor() {
    MockAudioContext.instances.push(this)
  }

  createOscillator() {
    const oscillator: MockOscillator = {
      connect: vi.fn(),
      frequency: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      start: vi.fn(),
      stop: vi.fn(),
      type: 'sine',
    }
    MockAudioContext.oscillators.push(oscillator)
    return oscillator
  }

  createGain() {
    return {
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    }
  }
}

function callListener(listener: EventListenerOrEventListenerObject, event: Event) {
  if (typeof listener === 'function') {
    listener(event)
  } else {
    listener.handleEvent(event)
  }
}

async function importWebAudioFeedback(
  listeners: Map<string, ListenerEntry[]>,
) {
  vi.resetModules()
  MockAudioContext.instances = []
  MockAudioContext.oscillators = []
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: MockAudioContext,
  })
  Object.defineProperty(window, 'webkitAudioContext', {
    configurable: true,
    writable: true,
    value: undefined,
  })
  vi.spyOn(document, 'addEventListener').mockImplementation((eventName, listener, options) => {
    const entries = listeners.get(eventName) ?? []
    entries.push({ listener, options })
    listeners.set(eventName, entries)
  })

  return import('./webAudioFeedback')
}

describe('webAudioFeedback iOS Safari unlock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    MockAudioContext.instances = []
    MockAudioContext.oscillators = []
  })

  it('registers gesture listeners that unlock AudioContext for iOS Safari PWA', async () => {
    const listeners = new Map<string, ListenerEntry[]>()

    await importWebAudioFeedback(listeners)

    for (const eventName of ['touchstart', 'pointerdown', 'click']) {
      expect(listeners.get(eventName)?.[0]?.options).toMatchObject({
        capture: true,
        passive: true,
      })
    }

    callListener(listeners.get('touchstart')![0].listener, new Event('touchstart'))

    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.instances[0].resume).toHaveBeenCalledTimes(1)
  })

  it('resumes the shared AudioContext when iOS Safari returns to the foreground', async () => {
    const listeners = new Map<string, ListenerEntry[]>()

    await importWebAudioFeedback(listeners)
    callListener(listeners.get('click')![0].listener, new Event('click'))
    const context = MockAudioContext.instances[0]
    context.resume.mockClear()
    context.state = 'suspended'
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')

    callListener(listeners.get('visibilitychange')![0].listener, new Event('visibilitychange'))

    expect(context.resume).toHaveBeenCalledTimes(1)
  })

  it('keeps the playback-time resume fallback for already suspended contexts', async () => {
    const listeners = new Map<string, ListenerEntry[]>()
    const { playWebAudioFeedbackEvent } = await importWebAudioFeedback(listeners)

    playWebAudioFeedbackEvent({ event: 'quiz_result_correct', volume: 1 })

    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.instances[0].resume).toHaveBeenCalledTimes(1)
  })

  it('plays firework accent tones from the shared tone profiles data source', async () => {
    const listeners = new Map<string, ListenerEntry[]>()
    const { playWebAudioFireworkAccent } = await importWebAudioFeedback(listeners)

    playWebAudioFireworkAccent({ kind: 'all_clear_ready', volume: 1 })

    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.oscillators).toHaveLength(4)
    expect(MockAudioContext.oscillators.map((oscillator) => oscillator.type)).toEqual([
      'triangle',
      'sine',
      'triangle',
      'sine',
    ])
  })
})
