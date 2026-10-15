import type { RequestOutcome } from '@/shared/api/requestOutcome'
import { resolveNavSection, type NavSectionKey } from '@/shared/routing/routeManifest'
import { truncateRecorderText } from './sessionRecorderFormat'
import type { SessionRecorderEvent } from './sessionRecorderTypes'

export const DIAGNOSIS_WINDOW_OPTIONS_MINUTES = [1, 2, 5] as const
export type DiagnosisWindowMinutes = (typeof DIAGNOSIS_WINDOW_OPTIONS_MINUTES)[number]
export const DIAGNOSIS_DEFAULT_WINDOW_MINUTES: DiagnosisWindowMinutes = 2
/** Events are kept for the longest selectable window so any option can be copied. */
export const DIAGNOSIS_MAX_WINDOW_MS = 5 * 60 * 1000
export const DIAGNOSIS_RECENT_MAX = 400
const CLICK_FOLLOW_MS = 4_000
const VIEW_CLICK_LEAD_MS = 1_500

export function diagnosisWindowMs(minutes: number) {
  return minutes * 60 * 1000
}

const SECTION_LABEL: Record<NavSectionKey, string> = {
  freestyle: '随心',
  palaces: '知识',
  english: '英语',
  knowledge: '创建',
  review: '洞察',
  progress: '进度',
}

const STEP_RULES: Array<{ method?: string; test: RegExp; label: string }> = [
  { test: /\/freestyle\/rounds\/[^/]+\/ratings$/, label: '提交评分' },
  { test: /\/freestyle\/rounds\/[^/]+\/actions$/, label: '记下这题的作答' },
  { test: /\/freestyle\/question-attempts$/, label: '记下这题的作答' },
  { test: /\/freestyle\/question-explanations$/, label: '请 AI 讲这题' },
  { test: /\/freestyle\/rounds\/start$/, label: '开始这一轮练习' },
  { test: /\/freestyle\/queue\/build$/, label: '准备下一轮题目' },
  { test: /\/session\/live\/commands$/, label: '同步正在学的进度' },
  { test: /\/palace-quiz-attempt-events$/, label: '交这道题' },
  { test: /\/palace-quiz-questions\/[^/]+\/mark$/, label: '标记这道题' },
  { test: /\/quiz\/practice-progress$/, label: '保存做题进度' },
  { method: 'PUT', test: /\/palaces\/[^/]+\/editor$/, label: '保存这份导图' },
  { method: 'POST', test: /\/palaces\/[^/]+\/editor$/, label: '保存这份导图' },
  { method: 'PUT', test: /\/subjects\/[^/]+\/editor$/, label: '保存知识树' },
  { method: 'POST', test: /\/subjects\/[^/]+\/editor$/, label: '保存知识树' },
  { test: /\/review\/units\/[^/]+\/sessions$/, label: '开始这张复习卡' },
  { test: /\/review\/ratings\/[^/]+\/undo$/, label: '撤销刚才的评分' },
  { test: /\/review\/units\/[^/]+\/schedule$/, label: '调整复习时间' },
  { test: /\/study-sessions\/[^/]+\/complete$/, label: '结束这次学习' },
  { test: /\/study-sessions\/[^/]+\/events$/, label: '记下学习过程' },
  { test: /\/profile\/client-preferences$/, label: '保存设置' },
  { test: /\/settings\/review$/, label: '保存复习设置' },
  { test: /\/backups\/create$/, label: '做一份备份' },
  { test: /\/backups\/restore-database$/, label: '恢复备份' },
  { test: /\/attachments(?:\/|$)/, label: '上传附件' },
  { test: /\/english\/courses\/[^/]+\/check$/, label: '检查这句英语' },
  { test: /\/english\/courses\/[^/]+\/progress$/, label: '保存英语进度' },
]

export interface RecorderFocus {
  place: string
  title: string
  excerpt: string
}

export function redactRecorderSecrets(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}/gi, '$1 …')
    .replace(/([?&](?:token|key|password|secret)=)[^&\s]+/gi, '$1…')
}

export function filterRecentEvents(
  events: SessionRecorderEvent[],
  now = Date.now(),
  windowMs = DIAGNOSIS_MAX_WINDOW_MS,
) {
  const cutoff = now - windowMs
  return events
    .filter((event) => {
      const at = Date.parse(event.at)
      return Number.isFinite(at) && at >= cutoff
    })
    .slice(-DIAGNOSIS_RECENT_MAX)
}

export function describeRecorderPage(pathname: string) {
  const path = (pathname.split(/[?#]/)[0] || '/').replace(/\/$/, '') || '/'
  const section = resolveNavSection(path)
  if (section) return SECTION_LABEL[section]
  if (path.startsWith('/profile')) return '设置'
  if (path.startsWith('/palaces')) return '知识'
  return '这个页面'
}

export function humanizeApiStep(method: string, path: string) {
  const normalized = method.toUpperCase()
  const rule = STEP_RULES.find((item) => (
    (!item.method || item.method === normalized) && item.test.test(path)
  ))
  if (rule) return rule.label
  if (normalized === 'DELETE') return '删掉一处内容'
  if (normalized === 'GET') return '读取这一页'
  if (/\/ai|explanation|generate/i.test(path)) return '请 AI 帮忙'
  return '保存一处改动'
}

export function plainFailureReason(message: string, status: number | null) {
  const text = message.toLowerCase()
  if (status === 409 || text.includes('冲突') || text.includes('conflict')) return '和另一处保存撞车了'
  if (status === 401 || status === 403) return '没有权限'
  if (status === 404) return '要找的内容不在了'
  if (
    text.includes('超时')
    || text.includes('timeout')
    || text.includes('aborterror')
    || text.includes('timed out')
  ) {
    return '等太久，这一步没有完成'
  }
  if (
    text.includes('failed to fetch')
    || text.includes('network')
    || text.includes('网络请求失败')
    || text.includes('连接')
  ) {
    return '连不上软件后台'
  }
  if (status != null && status >= 500) return '软件后台暂时出错'
  if (status === 400 || status === 422) return '提交的内容没有被接受'
  const firstLine = message.split('\n').map((line) => line.trim()).find(Boolean) || ''
  const cleaned = firstLine.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned.length > 60) return status ? `没有成功（${status}）` : '没有成功'
  return cleaned
}

export function describeRequestStep(outcome: RequestOutcome) {
  const action = humanizeApiStep(outcome.method, outcome.path)
  if (outcome.ok) return { action, detail: '成功' }
  const reason = plainFailureReason(outcome.message, outcome.status)
  const retry = outcome.queuedRetry ? '软件已留下稍后重试。' : ''
  const message = outcome.message.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  const technical = `${outcome.method} ${outcome.path} → ${outcome.status != null ? `HTTP ${outcome.status}` : '没有收到回应'}${message ? `：${message}` : ''}`
  return { action, detail: `没有成功：${reason}。${retry}［${technical}］`.trim() }
}

export function readRecorderFocus(root: ParentNode): RecorderFocus | null {
  const node = root.querySelector('[data-recorder-current="true"]')
  if (!(node instanceof HTMLElement)) return null
  const place = (node.getAttribute('data-recorder-place') || '').trim()
  const title = (node.getAttribute('data-recorder-title') || '').trim()
  const excerpt = truncateRecorderText(node.getAttribute('data-recorder-excerpt') || '', 80)
  if (!place && !title && !excerpt) return null
  return { place, title, excerpt }
}

function clock(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function actionLine(event: SessionRecorderEvent) {
  if (event.kind === 'click' || event.kind === 'menu') return `点了${event.detail || event.action}`
  if (event.kind === 'route') return `打开了${describeRecorderPage(event.detail || '')}`
  if (event.kind === 'doc' || event.kind === 'mindmap') {
    return `改了导图：${truncateRecorderText(event.detail || event.action, 60)}`
  }
  return [event.action, event.detail].filter(Boolean).join(' ')
}

/** The nearest click at or before `at`, within `windowMs`. */
function precedingClick(events: SessionRecorderEvent[], at: string, windowMs: number) {
  const time = Date.parse(at)
  return [...events].reverse().find((event) => {
    if (event.kind !== 'click' && event.kind !== 'menu') return false
    const delta = time - Date.parse(event.at)
    return delta >= 0 && delta <= windowMs
  })
}

function nearbyClick(events: SessionRecorderEvent[], step: SessionRecorderEvent) {
  return precedingClick(events, step.at, CLICK_FOLLOW_MS)
}

/**
 * A view change the app made on its own (feed snapped to a card or the
 * settlement page). The action text already says what changed; this only adds
 * whether a click came right before it.
 */
function viewSentence(events: SessionRecorderEvent[], view: SessionRecorderEvent) {
  const click = precedingClick(events, view.at, VIEW_CLICK_LEAD_MS)
  return click
    ? `点了${click.detail || click.action}之后，${view.action}`
    : `没有点击，${view.action}`
}

function stepSentence(step: SessionRecorderEvent, click: SessionRecorderEvent | undefined) {
  const when = clock(step.at)
  const failed = step.detail.startsWith('没有成功')
  const outcome = failed ? `${step.action}${step.detail}` : `${step.action}成功了。`
  const text = click ? `点了${click.detail || click.action}之后，${outcome}` : outcome
  return [when, text].filter(Boolean).join(' ')
}

export function buildDiagnosisBrief(input: {
  events: SessionRecorderEvent[]
  pageLabel: string
  focus: RecorderFocus | null
  windowMs?: number
  now?: number
}) {
  const now = input.now ?? Date.now()
  const windowMs = input.windowMs ?? diagnosisWindowMs(DIAGNOSIS_DEFAULT_WINDOW_MINUTES)
  const events = filterRecentEvents(input.events, now, windowMs)
  const actions = events.filter((event) => (
    event.kind === 'click'
    || event.kind === 'menu'
    || event.kind === 'route'
    || event.kind === 'view'
    || event.kind === 'doc'
    || event.kind === 'mindmap'
  ))
  const steps = events.filter((event) => event.kind === 'step')
  const errors = events.filter((event) => event.kind === 'error')
  const askedAi = events.some((event) => event.kind === 'ai')
  const shown = new Set<SessionRecorderEvent>()
  const outcomeLines = steps.flatMap((step) => {
    const failed = step.detail.startsWith('没有成功')
    const click = nearbyClick(events, step)
    if (!failed && !click) return []
    if (shown.size >= 8) return []
    shown.add(step)
    return [stepSentence(step, click)]
  })
  const hiddenSuccesses = steps.filter((step) => step.detail === '成功' && !shown.has(step)).length
  if (hiddenSuccesses > 0) outcomeLines.push(`还有 ${hiddenSuccesses} 次后台操作成功了。`)
  const lastClick = [...actions].reverse().find((event) => event.kind === 'click' || event.kind === 'menu')
  const lastClickFollowed = lastClick
    ? steps.some((step) => {
      const delta = Date.parse(step.at) - Date.parse(lastClick.at)
      return delta >= 0 && delta <= CLICK_FOLLOW_MS
    })
    : true
  if (lastClick && !lastClickFollowed) {
    outcomeLines.push(`点了${lastClick.detail || lastClick.action}之后的几秒里，没有看到后端写入。`)
  }
  if (outcomeLines.length === 0) outcomeLines.push('没有看到保存或提交。')

  const focusLines = input.focus
    ? [
      `- 位置：${input.focus.place || '没有写位置'}`,
      `- 标题：${input.focus.title || '没有写标题'}`,
      `- 摘录：${input.focus.excerpt || '没有摘录'}`,
    ]
    : ['- 没有定位到当前这一题或这一张卡。']

  const lines = [
    `最近 ${Math.round(windowMs / 60_000)} 分钟`,
    '',
    '我当时在看',
    `- 页面：${input.pageLabel || '这个页面'}`,
    ...focusLines,
    '',
    '我做了这些',
    ...(actions.length === 0
      ? ['- 这段时间没有点击，也没有换页面或切换卡片。']
      : actions.slice(-20).map((event) => {
        const when = clock(event.at)
        const text = event.kind === 'view' ? viewSentence(events, event) : actionLine(event)
        return `- ${[when, text].filter(Boolean).join(' ')}`
      })),
    '',
    '点完之后',
    ...outcomeLines.map((line) => `- ${line}`),
  ]
  if (errors.length > 0) {
    lines.push('', '页面上的报错', ...errors.slice(-3).map((event) => `- ${event.action}：${truncateRecorderText(event.detail, 80)}`))
  }
  if (askedAi) lines.push('', '期间请过 AI。')
  return lines.join('\n')
}
