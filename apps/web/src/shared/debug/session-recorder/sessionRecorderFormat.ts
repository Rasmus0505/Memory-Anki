export function formatSessionRecorderTimestamp(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatSessionRecorderClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

export function relativeSessionRecorderOffset(startedAt: string, at: string) {
  const start = Date.parse(startedAt)
  const current = Date.parse(at)
  if (!Number.isFinite(start) || !Number.isFinite(current)) return '00:00'
  return formatSessionRecorderClock(current - start)
}

const SAFE_ROUTE_LABELS = new Set(['随心', '知识', '英语', '创建', '洞察', '进度', '设置', '这个页面'])
const SAFE_ACTIONS = new Set([
  '开始录制', '停止录制', '较早的动作已省略', '路由变化', '点击控件', '点击输入框',
  '输入敏感字段', '菜单操作', '右键节点', '点击画布空白', '单击节点', '拖拽结束',
  '翻卡', '进入编辑', '返回学习', '导图操作', '导图编辑', '应用错误', 'AI操作',
  '自动切换卡片', '自动切到结算页', '状态变化',
])
const SAFE_FAILURE_REASONS = new Set([
  '和另一处保存撞车了', '没有权限', '要找的内容不在了', '等太久，这一步没有完成',
  '连不上软件后台', '软件后台暂时出错', '提交的内容没有被接受', '没有收到回应',
])

function safeRouteLabel(route: string) {
  return SAFE_ROUTE_LABELS.has(route) ? route : '这个页面'
}

function safeReportAction(kind: string, action: string) {
  if (SAFE_ACTIONS.has(action)) return action
  if (kind === 'step') return '后台操作'
  if (kind === 'session') return '状态变化'
  if (kind === 'click') return '点击控件'
  if (kind === 'menu') return '菜单操作'
  if (kind === 'mindmap') return '导图操作'
  if (kind === 'doc') return '导图编辑'
  if (kind === 'error') return '应用错误'
  if (kind === 'ai') return 'AI操作'
  if (kind === 'view') return '自动切换卡片'
  return '状态变化'
}

function safeReportDetail(kind: string, detail: string) {
  if (!detail) return ''
  if (kind === 'route' && SAFE_ROUTE_LABELS.has(detail)) return detail
  if (kind === 'doc' && /^(新增节点|删除节点|移动节点|修改节点) \d+$/.test(detail)) return detail
  if (kind === 'mindmap' && /^(翻开|收起) \d+ 项$/.test(detail)) return detail
  if (kind === 'step') {
    if (detail === '成功') return detail
    const match = detail.match(/^没有成功：(.+?)（(HTTP [1-5]\d\d|没有收到回应)）。(稍后会自动重试。)?$/)
    if (match && SAFE_FAILURE_REASONS.has(match[1])) return detail
  }
  if (kind === 'session' && /^只保留最近 \d+ 条$/.test(detail)) return detail
  return ''
}

export function formatSessionRecorderReport(input: {
  startedAt: string
  endedAt: string
  routes: string[]
  events: Array<{ at: string; kind: string; action: string; detail: string }>
}) {
  const durationMs = Math.max(0, Date.parse(input.endedAt) - Date.parse(input.startedAt))
  const routes = input.routes.filter(Boolean).map(safeRouteLabel)
  const lines = [
    '请根据以下操作记录排查错误。',
    '',
    `开始: ${formatSessionRecorderTimestamp(input.startedAt)}`,
    `结束: ${formatSessionRecorderTimestamp(input.endedAt)}`,
    `时长: ${formatSessionRecorderClock(durationMs)}`,
    `页面轨迹: ${routes.join(' → ') || '未知'}`,
    '',
    '## 时间线',
  ]
  if (input.events.length === 0) {
    lines.push('（没有捕获到操作）')
  } else {
    for (const event of input.events) {
      const offset = relativeSessionRecorderOffset(input.startedAt, event.at)
      const action = safeReportAction(event.kind, event.action)
      const detailValue = safeReportDetail(event.kind, event.detail)
      const detail = detailValue ? ` ${detailValue}` : ''
      lines.push(`[${offset}] ${action}${detail}`)
    }
  }
  return lines.join('\n')
}

export function buildSessionRecorderCopyText(reportText: string, notes: string) {
  const report = reportText.trim()
  const extra = notes.trim()
  if (!extra) return report
  if (!report) return `## 用户补充\n${extra}`
  return `${report}\n\n## 用户补充\n${extra}`
}
