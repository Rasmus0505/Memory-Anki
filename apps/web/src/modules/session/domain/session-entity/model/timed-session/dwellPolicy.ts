import type { SessionKind, SessionScene } from '@/modules/session/domain/session-entity/model/session-records'
import type { TimedSessionSourceKind } from '@/shared/hooks/timedSessionModel'

/** In-memory registry key for the single continuous dwell clock. */
export const DWELL_LIVE_SESSION_KEY = 'dwell:live'

/** Leave the app (hidden / closed) longer than this and the next visit starts a new record. */
export const DWELL_RESUME_WINDOW_MS = 15 * 60 * 1000

/** How often a running dwell clock writes a non-terminal saved checkpoint. */
export const DWELL_CHECKPOINT_INTERVAL_MS = 30_000

export const DWELL_SNAPSHOT_STORAGE_KEY = 'memory-anki-dwell-session'

export type DwellFragmentKind = SessionKind | 'english' | 'english_reading'

export interface DwellFragment {
  countable: boolean
  scene: SessionScene
  kind: DwellFragmentKind
  title: string
  routePath: string
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
}

function pathnameOf(path: string) {
  return (path.split(/[?#]/, 1)[0] || '/').replace(/\/+$/, '') || '/'
}

export function isDwellSessionKey(sessionKey: string | null | undefined) {
  const key = String(sessionKey || '').trim()
  return key === DWELL_LIVE_SESSION_KEY || key.startsWith('dwell:')
}

export function dwellSessionKeyForRecord(recordId: string) {
  return `dwell:${recordId}`
}

export function isDwellExcludedPath(path: string) {
  const pathname = pathnameOf(path)
  if (pathname === '/profile' || pathname.startsWith('/profile/')) return true
  if (pathname === '/timer-overlay' || pathname.startsWith('/timer-overlay/')) return true
  if (pathname === '/dev/tokens' || pathname.startsWith('/dev/tokens/')) return true
  return false
}

export function shouldResumeDwell(hiddenAtMs: number | null | undefined, nowMs: number) {
  if (hiddenAtMs == null || !Number.isFinite(hiddenAtMs)) return true
  return Math.max(0, nowMs - hiddenAtMs) <= DWELL_RESUME_WINDOW_MS
}

export function formatDwellRecordTitle(startedAt: Date) {
  const hours = `${startedAt.getHours()}`.padStart(2, '0')
  const minutes = `${startedAt.getMinutes()}`.padStart(2, '0')
  return `${hours}:${minutes} 学习时段`
}

function palaceIdFrom(path: string) {
  const match = pathnameOf(path).match(/^\/palaces\/(\d+)(?:\/|$)/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) ? id : null
}

function courseIdFrom(path: string) {
  const match = pathnameOf(path).match(/^\/english\/listening\/courses\/(\d+)(?:\/|$)/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) ? id : null
}

export interface DwellFragmentOverride {
  scene: SessionScene
  kind: DwellFragmentKind
  title: string
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  /** Higher priority wins. 查看宫殿 stays above 做题 even if the quiz re-renders. */
  priority?: number
}

export function applyDwellFragmentOverride(
  fragment: DwellFragment,
  override: DwellFragmentOverride | null,
): DwellFragment {
  if (!override || !fragment.countable) return fragment
  return {
    ...fragment,
    scene: override.scene,
    kind: override.kind,
    title: override.title,
    palaceId: override.palaceId ?? fragment.palaceId,
    sourceKind: override.sourceKind ?? fragment.sourceKind,
  }
}

export function resolveDwellFragment(path: string): DwellFragment {
  const routePath = pathnameOf(path)
  const excluded = isDwellExcludedPath(routePath)
  const base = {
    countable: !excluded,
    routePath,
    palaceId: null as number | null,
    sourceKind: null as TimedSessionSourceKind,
    englishCourseId: null as number | null,
  }

  if (excluded) {
    return {
      ...base,
      countable: false,
      scene: 'custom',
      kind: 'custom',
      title: '设置',
    }
  }

  if (routePath === '/' || routePath === '/dashboard') {
    return { ...base, scene: 'dashboard', kind: 'practice', title: '洞察' }
  }
  if (routePath === '/freestyle' || routePath.startsWith('/freestyle/')) {
    return { ...base, scene: 'freestyle', kind: 'quiz', title: '随心' }
  }
  if (routePath === '/freestyle-2' || routePath.startsWith('/freestyle-2/')) {
    return { ...base, scene: 'freestyle', kind: 'quiz', title: '随心 2' }
  }
  if (routePath === '/palaces' || routePath === '/palaces/list') {
    return {
      ...base,
      scene: 'palace_list',
      kind: 'practice',
      title: routePath === '/palaces/list' ? '宫殿列表' : '宫殿架',
    }
  }
  if (routePath === '/palaces/new') {
    return { ...base, scene: 'palace_edit', kind: 'palace_edit', title: '新建宫殿' }
  }

  const palaceId = palaceIdFrom(routePath)
  if (palaceId != null && routePath.endsWith('/edit')) {
    return {
      ...base,
      scene: 'palace_edit',
      kind: 'palace_edit',
      title: '宫殿编辑',
      palaceId,
      sourceKind: 'palace',
    }
  }
  if (palaceId != null && routePath.endsWith('/quiz')) {
    return {
      ...base,
      scene: 'quiz',
      kind: 'quiz',
      title: '宫殿做题',
      palaceId,
      sourceKind: 'palace',
    }
  }
  if (palaceId != null && routePath === `/palaces/${palaceId}`) {
    return {
      ...base,
      scene: 'practice',
      kind: 'practice',
      title: '宫殿查看',
      palaceId,
      sourceKind: 'palace',
    }
  }

  if (routePath === '/english') {
    return { ...base, scene: 'english_hub', kind: 'english', title: '英语', sourceKind: 'english' }
  }
  if (routePath === '/english/listening') {
    return { ...base, scene: 'english_hub', kind: 'english', title: '英语听力', sourceKind: 'english' }
  }
  const englishCourseId = courseIdFrom(routePath)
  if (englishCourseId != null) {
    return {
      ...base,
      scene: 'english',
      kind: 'english',
      title: '英语课程',
      sourceKind: 'english',
      englishCourseId,
    }
  }
  if (routePath === '/english/reading' || routePath.startsWith('/english/reading/')) {
    return {
      ...base,
      scene: 'english_reading',
      kind: 'english_reading',
      title: '英语阅读',
      sourceKind: 'english_reading',
    }
  }
  if (routePath === '/english/patterns') {
    return { ...base, scene: 'english_patterns', kind: 'english', title: '英语句型', sourceKind: 'english' }
  }
  if (routePath === '/english/vocab') {
    return { ...base, scene: 'english_vocab', kind: 'english', title: '英语词汇', sourceKind: 'english' }
  }
  if (routePath === '/knowledge' || routePath.startsWith('/knowledge/')) {
    return { ...base, scene: 'knowledge', kind: 'practice', title: '知识树' }
  }
  if (routePath === '/batch-generation' || routePath.startsWith('/batch-generation/')) {
    return { ...base, scene: 'batch_generation', kind: 'practice', title: '批量生成' }
  }

  return { ...base, scene: 'practice', kind: 'practice', title: '学习' }
}

export function segmentKindFromScene(scene: string, fallback: DwellFragmentKind): DwellFragmentKind {
  if (scene === 'english' || scene === 'english_hub' || scene === 'english_patterns' || scene === 'english_vocab') {
    return 'english'
  }
  if (scene === 'english_reading') return 'english_reading'
  if (scene === 'quiz' || scene === 'freestyle') return 'quiz'
  if (scene === 'palace_edit') return 'palace_edit'
  if (scene === 'review') return 'review'
  if (scene === 'custom') return 'custom'
  if (scene === 'practice') return 'practice'
  return fallback
}

export function dwellKindToSessionKind(kind: string | null | undefined): SessionKind {
  if (kind === 'palace_edit' || kind === 'quiz' || kind === 'review' || kind === 'custom') {
    return kind
  }
  return 'practice'
}

export function pickDominantFragmentKind(
  segments: Array<{ kind?: string | null; effectiveSeconds?: number | null }>,
  fallback: DwellFragmentKind,
): DwellFragmentKind {
  const totals = new Map<string, number>()
  for (const segment of segments) {
    const kind = String(segment.kind || '').trim()
    if (!kind) continue
    totals.set(kind, (totals.get(kind) ?? 0) + Math.max(0, Math.round(segment.effectiveSeconds || 0)))
  }
  let winner: string | null = null
  let winnerSeconds = -1
  for (const [kind, seconds] of totals) {
    if (seconds > winnerSeconds) {
      winner = kind
      winnerSeconds = seconds
    }
  }
  if (
    winner === 'palace_edit'
    || winner === 'practice'
    || winner === 'quiz'
    || winner === 'review'
    || winner === 'custom'
    || winner === 'english'
    || winner === 'english_reading'
  ) {
    return winner
  }
  return fallback
}
