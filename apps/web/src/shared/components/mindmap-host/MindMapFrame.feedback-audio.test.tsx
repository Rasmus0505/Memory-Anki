import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame } from './MindMapFrame'
import { attachIframeBridge, buildEditorState, getHostBridge } from './MindMapFrame.test-utils'
import { __resetLegacyAudioContextForTests } from './legacyWebAudio'

describe('MindMapFrame feedback audio behavior', () => {
  let createOscillator: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    __resetLegacyAudioContextForTests()
    createOscillator = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      frequency: {
        linearRampToValueAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
      start: vi.fn(),
      stop: vi.fn(),
      type: 'sine',
    }))
    const createGain = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
    }))
    const createStereoPanner = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      pan: {
        setValueAtTime: vi.fn(),
      },
    }))
    const resume = vi.fn().mockResolvedValue(undefined)
    const AudioContextMock = vi.fn(() => ({
      createGain,
      createOscillator,
      createStereoPanner,
      currentTime: 0,
      destination: {},
      resume,
      state: 'running',
    }))
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: AudioContextMock,
    })
  })

  afterEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('plays audio when the host reports a feedback event', async () => {
    render(<MindMapFrame editorState={buildEditorState()} onEditorStateChange={vi.fn()} />)
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    attachIframeBridge(iframe)

    await act(async () => {
      getHostBridge()?.notify?.('feedback_event', { type: 'save_success' })
    })

    expect(createOscillator).toHaveBeenCalled()
  })

  it('coalesces one node click into a single semantic audio event', async () => {
    vi.useFakeTimers()
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

    expect(createOscillator).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(120)
    })

    expect(createOscillator).toHaveBeenCalledTimes(1)
  })

  it('lets edit-start audio replace pending click and selection feedback', async () => {
    vi.useFakeTimers()
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

    expect(createOscillator).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(160)
    })

    expect(createOscillator).toHaveBeenCalledTimes(2)
  })

  it('coalesces repeated key presses but keeps structure feedback audible', async () => {
    vi.useFakeTimers()
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

    expect(createOscillator).toHaveBeenCalledTimes(1)

    await act(async () => {
      getHostBridge()?.notify?.('feedback_event', {
        type: 'node_create',
        source: 'keydown',
        nodeUid: 'node-1',
      })
    })

    expect(createOscillator).toHaveBeenCalledTimes(3)
  })
})
