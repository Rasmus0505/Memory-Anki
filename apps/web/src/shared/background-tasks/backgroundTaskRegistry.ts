import { useSyncExternalStore } from 'react'

/**
 * 全局后台任务注册中心。
 *
 * 目的：让"切走页面后仍在跑的 AI 生成 / 导入任务"对用户可见、可管控。
 * 任何长时任务（宫殿导入、英语 ASR、英语阅读生成等）通过 registerTask 登记，
 * 在 running / completed / failed 之间流转；UI 通过 useBackgroundTasks() 订阅
 * 并渲染全局任务栏 + 侧边栏角标。
 *
 * 设计取舍：模块级 store + useSyncExternalStore。不引入 Redux/Zustand；
 * 与路由 keep-alive（AppRouter）配合——任务源页面被 display:none 隐藏时
 * 组件不卸载、轮询/流仍在更新 state，注册中心只是把"哪些在跑"的视图
 * 提升到全局，使其它页面也能感知。
 */

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed'

export type BackgroundTaskSection =
  | 'dashboard'
  | 'palaces'
  | 'palaceQuiz'
  | 'english'
  | 'englishReading'
  | 'knowledge'
  | 'review'
  | 'profile'

export interface BackgroundTask {
  /** 唯一 id（通常用任务源 id，如 jobId/taskId/materialId 组合）。 */
  id: string
  /** 归属侧边栏区段，用于在该入口显示角标。 */
  section: BackgroundTaskSection
  /** 显示标题，如"记忆宫殿 · 导入中"。 */
  title: string
  status: BackgroundTaskStatus
  /** 进度 0-100，可选。 */
  progress?: number
  /** 详情文案，如"识别中 · 已生成 12 个节点"。 */
  detail?: string
  /** 点击任务条跳回的 URL。 */
  navigateTarget?: string
  createdAt: number
  /** 最近一次状态更新时间。 */
  updatedAt: number
}

interface StoreState {
  tasks: Record<string, BackgroundTask>
}

let state: StoreState = { tasks: {} }
const listeners = new Set<() => void>()

function setState(next: StoreState) {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 仅供测试：暴露 subscribe 以便非 React 上下文验证订阅通知。 */
export function __subscribeForTest(listener: () => void) {
  return subscribe(listener)
}

function getSnapshot() {
  return state
}

/**
 * 返回当前所有任务（按 updatedAt 倒序）。纯函数读取，便于在非 React 上下文
 * （如测试）中直接断言 store 状态。
 */
export function getBackgroundTasks(): BackgroundTask[] {
  return Object.values(state.tasks).sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 返回指定 section 下处于 running 状态的任务数。纯函数读取。
 */
export function getRunningTaskCountBySection(section: BackgroundTaskSection): number {
  let count = 0
  for (const task of Object.values(state.tasks)) {
    if (task.section === section && task.status === 'running') count += 1
  }
  return count
}

function bumpTask(task: BackgroundTask): StoreState {
  return { tasks: { ...state.tasks, [task.id]: task } }
}

function removeTask(id: string): StoreState {
  const next = { ...state.tasks }
  delete next[id]
  return { tasks: next }
}

/** 登记一个后台任务（若已存在则更新）。 */
export function registerTask(input: {
  id: string
  section: BackgroundTaskSection
  title: string
  detail?: string
  progress?: number
  navigateTarget?: string
}): void {
  const now = Date.now()
  const existing = state.tasks[input.id]
  const task: BackgroundTask = {
    id: input.id,
    section: input.section,
    title: input.title,
    status: 'running',
    detail: input.detail,
    progress: input.progress,
    navigateTarget: input.navigateTarget,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  setState(bumpTask(task))
}

/** 更新运行中任务的进度/详情（不会改变 status）。 */
export function updateTask(
  id: string,
  patch: { progress?: number; detail?: string; title?: string },
): void {
  const current = state.tasks[id]
  if (!current) return
  if (current.status !== 'running') return
  setState(
    bumpTask({
      ...current,
      title: patch.title ?? current.title,
      detail: patch.detail ?? current.detail,
      progress: patch.progress ?? current.progress,
      updatedAt: Date.now(),
    }),
  )
}

/** 标记任务为完成（可选延迟自动移除以让用户看到"已完成"提示）。 */
export function completeTask(
  id: string,
  patch?: { detail?: string; progress?: number },
): void {
  const current = state.tasks[id]
  if (!current) return
  setState(
    bumpTask({
      ...current,
      status: 'completed',
      progress: patch?.progress ?? 100,
      detail: patch?.detail ?? current.detail,
      updatedAt: Date.now(),
    }),
  )
  // 5 秒后自动清除已完成任务，避免任务栏长期堆积。
  window.setTimeout(() => {
    if (state.tasks[id]?.status === 'completed') {
      setState(removeTask(id))
    }
  }, 5000)
}

/** 标记任务为失败。 */
export function failTask(id: string, detail?: string): void {
  const current = state.tasks[id]
  if (!current) return
  setState(
    bumpTask({
      ...current,
      status: 'failed',
      detail: detail ?? current.detail,
      updatedAt: Date.now(),
    }),
  )
  // 失败任务保留 8 秒后清除。
  window.setTimeout(() => {
    if (state.tasks[id]?.status === 'failed') {
      setState(removeTask(id))
    }
  }, 8000)
}

/** 显式移除（用于取消、清理等场景）。 */
export function dismissTask(id: string): void {
  if (!state.tasks[id]) return
  setState(removeTask(id))
}

/** 仅供测试：重置整个 store。 */
export function __resetBackgroundTaskStoreForTest(): void {
  setState({ tasks: {} })
}

/**
 * 订阅后台任务列表。
 * 默认按 updatedAt 倒序返回所有任务（含已完成/失败的待清除项）。
 */
export function useBackgroundTasks(): BackgroundTask[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return Object.values(snapshot.tasks).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 订阅指定 section 下处于 running 状态的任务数，用于侧边栏角标。 */
export function useRunningTaskCountBySection(section: BackgroundTaskSection): number {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  let count = 0
  for (const task of Object.values(snapshot.tasks)) {
    if (task.section === section && task.status === 'running') count += 1
  }
  return count
}
