import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { subscribeEnglishTaskStream } from '@/modules/english/domain/english-entity/api'

class FakeEventSource {
  static instances: FakeEventSource[] = []

  listeners = new Map<string, Array<(event: Event) => void>>()
  closed = false
  onerror: ((event: Event) => void) | null = null
  url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: (event: Event) => void) {
    const existing = this.listeners.get(name) || []
    existing.push(listener)
    this.listeners.set(name, existing)
  }

  emit(name: string, payload: unknown) {
    const listeners = this.listeners.get(name) || []
    const event = new MessageEvent(name, {
      data: JSON.stringify(payload),
    })
    listeners.forEach((listener) => listener(event))
  }

  close() {
    this.closed = true
  }
}

describe('subscribeEnglishTaskStream', () => {
  const originalEventSource = globalThis.EventSource

  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalEventSource) {
      globalThis.EventSource = originalEventSource
    }
  })

  it('delivers stream events and closes on done', () => {
    const onStatus = vi.fn()
    const onLog = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    const unsubscribe = subscribeEnglishTaskStream('task-1', {
      onStatus,
      onLog,
      onDone,
      onError,
    })
    const instance = FakeEventSource.instances[0]
    expect(instance.url).toContain('/api/v1/english/tasks/task-1/stream')

    instance.emit('status', {
      task: {
        id: 'task-1',
        status: 'running',
        stage: 'translate',
        progressPercent: 80,
        message: '正在翻译句子 8/10',
        sourceFilename: 'lesson.mp4',
        fileSize: 12,
        errorMessage: '',
        courseId: null,
        createdAt: null,
        updatedAt: null,
        startedAt: null,
        completedAt: null,
      },
    })
    instance.emit('log', {
      event: {
        id: 'evt-1',
        timestamp: '2026-06-04T12:00:00',
        stage: 'translate',
        kind: 'progress',
        message: '翻译进度 8/10。',
        data: {},
      },
    })
    instance.emit('done', {
      task: {
        id: 'task-1',
        status: 'completed',
        stage: 'completed',
        progressPercent: 100,
        message: '课程已生成',
        sourceFilename: 'lesson.mp4',
        fileSize: 12,
        errorMessage: '',
        courseId: 3,
        createdAt: null,
        updatedAt: null,
        startedAt: null,
        completedAt: null,
      },
    })

    expect(onStatus).toHaveBeenCalledTimes(1)
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(instance.closed).toBe(true)

    unsubscribe()
    expect(instance.closed).toBe(true)
  })

  it('reports connection errors', () => {
    const onError = vi.fn()
    subscribeEnglishTaskStream('task-2', { onError })
    const instance = FakeEventSource.instances[0]

    instance.onerror?.(new Event('error'))

    expect(onError).toHaveBeenCalledWith({ error: '英语任务实时连接已断开。' })
    expect(instance.closed).toBe(true)
  })
})
