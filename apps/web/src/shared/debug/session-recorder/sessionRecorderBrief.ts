import type { RequestOutcome } from '@/shared/api/requestOutcome'
import { resolveNavSection, type NavSectionKey } from '@/shared/routing/routeManifest'
import { truncateRecorderText } from './sessionRecorderFormat'
import type { SessionRecorderEvent } from './sessionRecorderTypes'

export const DIAGNOSIS_WINDOW_MS = 5 * 60 * 1000
export const DIAGNOSIS_RECENT_MAX = 160
const CLICK_FOLLOW_MS = 4_000

const SECTION_LABEL: Record<NavSectionKey, string> = {
  freestyle: '随心',
  freestyleSecondary: '随心',
  palaces: '知识',
  english: '英语',
  knowledge: '创建',
  review: '洞察',
  progress: '进度',
}

const STEP_RULES: Array<{ method?: string; test: RegExp; label: string }> = [
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
  windowMs = DIAGNOSIS_WINDOW_MS,
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
  return { action, detail: `没有成功：${reason}。${retry}`.trim() }
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

function nearbyClick(events: SessionRecorderEvent[], step: SessionRecorderEvent) {
  const at = Date.parse(step.at)
  return [...events].reverse().find((event) => {
    if (event.kind !== 'click' && event.kind !== 'menu') return false
    const delta = at - Date.parse(event.at)
    return delta >= 0 && delta <= CLICK_FOLLOW_MS
  })
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
  now?: number
}) {
  const now = input.now ?? Date.now()
  const events = filterRecentEvents(input.events, now)
  const actions = events.filter((event) => (
    event.kind === 'click' || event.kind === 'menu' || event.kind === 'route' || event.kind === 'doc' || event.kind === 'mindmap'
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
    outcomeLines.push(`点了${lastClick.detail || lastClick.action}之后的几秒里，没有看到写入。如果这一步本来该保存，可能没写上；如果只是翻页或展开，可以忽略。`)
  }
  if (outcomeLines.length === 0) outcomeLines.push('没有看到保存或提交。')

  const watch: string[] = []
  const failedAfterClick = [...steps].reverse().find((step) => (
    step.detail.startsWith('没有成功') && nearbyClick(events, step)
  ))
  if (failedAfterClick) {
    const click = nearbyClick(events, failedAfterClick)
    watch.push(click
      ? `先看点了${click.detail || click.action}之后，「${failedAfterClick.action}」为什么没有成功。`
      : `先看「${failedAfterClick.action}」为什么没有成功。`)
  } else if (lastClick && !lastClickFollowed) {
    watch.push(`先确认点了${lastClick.detail || lastClick.action}之后，该写上的内容有没有写上。`)
  } else if (errors[0]) {
    watch.push(`页面报了「${errors[0].action}」，先看这个报错和刚才的操作是不是同一件事。`)
  } else if (steps.some((step) => step.detail === '成功')) {
    watch.push('这几分钟里，看到的保存都成功了。如果画面不对，更可能是显示没有跟上，而不是没写上。')
  } else {
    watch.push('记录很少。如果问题出在更早，请补一句大概是什么时候、画面上看到了什么。')
  }

  const focusLines = input.focus
    ? [
      `- 位置：${input.focus.place || '没有写位置'}`,
      `- 标题：${input.focus.title || '没有写标题'}`,
      `- 摘录：${input.focus.excerpt || '没有摘录'}`,
    ]
    : ['- 没有定位到当前这一题或这一张卡。']

  const lines = [
    '请根据下面这段刚才的操作，帮我看看出了什么问题。以这段记录为准，不要假设我记得按钮的内部名字。',
    '记录里没有密码、密钥，也没有完整网页地址。',
    '',
    '我当时在看',
    `- 页面：${input.pageLabel || '这个页面'}`,
    ...focusLines,
    '',
    '我做了这些',
    ...(actions.length === 0
      ? ['- 这几分钟里没有点到按钮，也没有换页面。']
      : actions.slice(-12).map((event) => `- ${actionLine(event)}`)),
    '',
    '点完之后',
    ...outcomeLines.map((line) => `- ${line}`),
  ]
  if (errors.length > 0) {
    lines.push('', '页面上的报错', ...errors.slice(-3).map((event) => `- ${event.action}：${truncateRecorderText(event.detail, 80)}`))
  }
  if (askedAi) lines.push('', '期间请过 AI。')
  lines.push('', '请先看这些', ...watch.map((line) => `- ${line}`))
  return lines.join('\n')
}
