import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetBackgroundTaskStoreForTest,
  __subscribeForTest,
  completeTask,
  dismissTask,
  failTask,
  getBackgroundTasks,
  getRunningTaskCountBySection,
  registerTask,
  setTaskBubblePosition,
  updateTask,
} from '@/shared/background-tasks/backgroundTaskRegistry'

afterEach(() => {
  __resetBackgroundTaskStoreForTest()
})

describe('backgroundTaskRegistry store', () => {
  it('registerTask adds a running task', () => {
    registerTask({
      id: 'palace-import-1',
      section: 'palaces',
      title: '记忆宫殿 · 识别导入中',
    })
    const tasks = getBackgroundTasks()

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'palace-import-1',
      status: 'running',
      section: 'palaces',
    })
    expect(getRunningTaskCountBySection('palaces')).toBe(1)
  })

  it('registerTask notifies subscribers', () => {
    let notifyCount = 0
    const unsubscribe = __subscribeForTest(() => {
      notifyCount += 1
    })

    registerTask({ id: 't1', section: 'palaces', title: 't' })

    expect(notifyCount).toBe(1)
    unsubscribe()
  })

  it('updateTask updates progress and detail without changing status', () => {
    registerTask({ id: 'english-asr-1', section: 'english', title: 'ASR' })
    updateTask('english-asr-1', { progress: 42, detail: '语音转写中' })

    const [task] = getBackgroundTasks()
    expect(task.progress).toBe(42)
    expect(task.detail).toBe('语音转写中')
    expect(task.status).toBe('running')
    expect(getRunningTaskCountBySection('english')).toBe(1)
  })

  it('re-registering the same id updates in place (keeps createdAt)', () => {
    registerTask({ id: 't1', section: 'palaces', title: 'first' })
    const firstCreatedAt = getBackgroundTasks()[0].createdAt

    registerTask({ id: 't1', section: 'palaces', title: 'second' })

    const tasks = getBackgroundTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('second')
    expect(tasks[0].createdAt).toBe(firstCreatedAt)
  })

  it('completeTask marks status completed and schedules auto-removal', () => {
    vi.useFakeTimers()
    try {
      registerTask({ id: 't1', section: 'english', title: 'task' })
      completeTask('t1', { detail: 'done' })

      expect(getBackgroundTasks()[0].status).toBe('completed')

      vi.advanceTimersByTime(5001)
      expect(getBackgroundTasks()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('failTask marks status failed and schedules auto-removal', () => {
    vi.useFakeTimers()
    try {
      registerTask({ id: 't1', section: 'english', title: 'task' })
      failTask('t1', 'boom')

      const [task] = getBackgroundTasks()
      expect(task.status).toBe('failed')
      expect(task.detail).toBe('boom')

      vi.advanceTimersByTime(8001)
      expect(getBackgroundTasks()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updateTask can refresh detail for completed tasks without restoring running state', () => {
    registerTask({ id: 't1', section: 'palaces', title: 'task', progress: 10 })
    completeTask('t1')
    updateTask('t1', { progress: 90, detail: 'ready' })

    const [task] = getBackgroundTasks()
    expect(task.progress).toBe(90)
    expect(task.detail).toBe('ready')
    expect(task.status).toBe('completed')
  })

  it('dismissTask removes a task immediately', () => {
    registerTask({ id: 't1', section: 'palaces', title: 'task' })
    dismissTask('t1')

    expect(getBackgroundTasks()).toHaveLength(0)
  })

  it('getRunningTaskCountBySection counts only running tasks for the section', () => {
    registerTask({ id: 'p1', section: 'palaces', title: 'p1' })
    registerTask({ id: 'p2', section: 'palaces', title: 'p2' })
    registerTask({ id: 'e1', section: 'english', title: 'e1' })
    completeTask('p1')

    expect(getRunningTaskCountBySection('palaces')).toBe(1)
    expect(getRunningTaskCountBySection('english')).toBe(1)
  })

  it('tasks are sorted by updatedAt descending', () => {
    registerTask({ id: 'old', section: 'palaces', title: 'old' })
    // 让 updatedAt 拉开差距。
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(100)
      registerTask({ id: 'new', section: 'palaces', title: 'new' })
    } finally {
      vi.useRealTimers()
    }

    const tasks = getBackgroundTasks()
    expect(tasks[0].id).toBe('new')
    expect(tasks[1].id).toBe('old')
  })

  it('stores bubble metadata for quiz generation tasks', () => {
    registerTask({
      id: 'quiz-1',
      section: 'palaceQuiz',
      title: 'quiz',
      kind: 'quiz-generation',
      bubble: { x: 100, y: 120 },
    })
    setTaskBubblePosition('quiz-1', { x: 180, y: 220 })

    const [task] = getBackgroundTasks()
    expect(task.kind).toBe('quiz-generation')
    expect(task.bubble).toEqual({ x: 180, y: 220 })
  })
})
