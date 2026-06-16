import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame } from './MindMapFrame'
import { attachIframeBridge, buildEditorState, getHostBridge } from './MindMapFrame.test-utils'

function installAudioContextMock() {
  const oscillator = {
    type: 'sine',
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
  const gainNode = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }
  const panNode = {
    pan: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
  }
  const filterNode = {
    type: 'highpass',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
  }
  const bufferSource = {
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
  const buffer = {
    getChannelData: vi.fn(() => new Float32Array(32)),
  }
  const audioContext = {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gainNode),
    createStereoPanner: vi.fn(() => panNode),
    createBuffer: vi.fn(() => buffer),
    createBufferSource: vi.fn(() => bufferSource),
    createBiquadFilter: vi.fn(() => filterNode),
    close: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
  }
  const AudioContextMock = vi.fn(() => audioContext)
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: AudioContextMock,
  })
  return { AudioContextMock, audioContext }
}

describe('MindMapFrame feedback audio behavior', () => {
  beforeEach(() => {
    window.__memoryAnkiMindMapHosts = {}
  })

  afterEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('plays audio when the host reports a feedback event', async () => {
    const { AudioContextMock, audioContext } = installAudioContextMock()
    render(<MindMapFrame editorState={buildEditorState()} onEditorStateChange={vi.fn()} />)
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    attachIframeBridge(iframe)

    await act(async () => {
      getHostBridge()?.notify?.('feedback_event', { type: 'save_success' })
    })

    expect(AudioContextMock).toHaveBeenCalled()
    expect(audioContext.createOscillator).toHaveBeenCalled()
  })

  it('coalesces one node click into a single semantic audio event', async () => {
    vi.useFakeTimers()
    const { audioContext } = installAudioContextMock()
    render(<MindMapFrame editorState={buildEditorState()} onEditorStateChange={vi.fn()} />)
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    attachIframeBridge(iframe)

    await act(async () => {
      getHostBridge()?.notify?.('feedback_event', {
        type: 'pointer_click',
        source: 'pointerup',
        nodeUid: 'node-1',
      })
      getHostBridge()?.notify?.('feedback_event', {
        type: 'node_select',
        source: 'node_active',
        nodeUid: 'node-1',
      })
      getHostBridge()?.notify?.('feedback_event', {
        type: 'pointer_click',
        source: 'node_click',
        nodeUid: 'node-1',
      })
    })

    expect(audioContext.createOscillator).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(120)
    })

    expect(audioContext.createOscillator).toHaveBeenCalledTimes(1)
  })

  it('lets edit-start audio replace pending click and selection feedback', async () => {
    vi.useFakeTimers()
    const { audioContext } = installAudioContextMock()
    render(<MindMapFrame editorState={buildEditorState()} onEditorStateChange={vi.fn()} />)
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    attachIframeBridge(iframe)

    await act(async () => {
      getHostBridge()?.notify?.('feedback_event', {
        type: 'pointer_click',
        source: 'pointerup',
        nodeUid: 'node-1',
      })
      getHostBridge()?.notify?.('feedback_event', {
        type: 'node_select',
        source: 'node_active',
        nodeUid: 'node-1',
      })
      getHostBridge()?.notify?.('feedback_event', {
        type: 'node_edit_start',
        source: 'dblclick',
        nodeUid: 'node-1',
      })
    })

    expect(audioContext.createOscillator).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(160)
    })

    expect(audioContext.createOscillator).toHaveBeenCalledTimes(2)
  })

  it('coalesces repeated key presses but keeps structure feedback audible', async () => {
    vi.useFakeTimers()
    const { audioContext } = installAudioContextMock()
    render(<MindMapFrame editorState={buildEditorState()} onEditorStateChange={vi.fn()} />)
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    attachIframeBridge(iframe)

    await act(async () => {
      getHostBridge()?.notify?.('feedback_event', {
        type: 'key_press',
        source: 'keydown',
        nodeUid: 'node-1',
      })
      getHostBridge()?.notify?.('feedback_event', {
        type: 'key_press',
        source: 'keydown',
        nodeUid: 'node-1',
      })
      getHostBridge()?.notify?.('feedback_event', {
        type: 'key_press',
        source: 'keydown',
        nodeUid: 'node-1',
      })
    })

    await act(async () => {
      vi.advanceTimersByTime(56)
    })

    expect(audioContext.createOscillator).toHaveBeenCalledTimes(1)

    await act(async () => {
      getHostBridge()?.notify?.('feedback_event', {
        type: 'node_create',
        source: 'keydown',
        nodeUid: 'node-1',
      })
    })

    expect(audioContext.createOscillator).toHaveBeenCalledTimes(3)
    expect(audioContext.createBuffer).not.toHaveBeenCalled()
  })
})
