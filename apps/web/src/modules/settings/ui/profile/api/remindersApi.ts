import { request } from '@/shared/api/http'

export type ReminderContentMode = 'detailed' | 'vague'
export type ReminderSlot = 'morning' | 'evening'
export type ReminderKind = ReminderSlot | 'ready' | 'idle' | 'hourly'

export interface ReminderSettings {
  enabled: boolean
  morning_time: string
  evening_time: string
  morning_enabled: boolean
  evening_enabled: boolean
  morning_window_minutes: number
  evening_window_minutes: number
  due_threshold: number
  content_mode: ReminderContentMode
  bark_group: string
  /** 公网可访问的图片地址；留空用 Bark 默认图标。 */
  icon_url: string
  quiet_start_hour: number
  quiet_end_hour: number
  idle_enabled: boolean
  idle_after_minutes: number
  idle_repeat_minutes: number
  idle_max_repeats: number
  idle_requires_activity_today: boolean
  ready_enabled: boolean
  ready_min_units: number
  ready_min_gap_minutes: number
  hourly_enabled: boolean
  daily_cap: number
  /** 服务端只回打码后的 Key，原值永远不下发。 */
  bark_key_masked: string
  bark_configured: boolean
}

export interface ReminderDeliverySummary {
  status: 'pending' | 'sent' | 'failed'
  slot: string
  study_day: string
  at: string | null
  title: string
  http_status: number | null
  error: string
}

export interface ReminderStatus {
  enabled: boolean
  bark_configured: boolean
  next_at: string | null
  next_slot: ReminderSlot | null
  consecutive_failures: number
  sent_today: number
  daily_cap: number
  last_delivery: ReminderDeliverySummary | null
}

export interface ReminderSettingsResponse {
  settings: ReminderSettings
  status: ReminderStatus
}

export interface ReminderTestResponse {
  ok: boolean
  error: string
  kind?: ReminderKind
  title?: string
  body?: string
}

export function getReminderSettingsApi() {
  return request<ReminderSettingsResponse>('/reminders/settings')
}

/** 省略 `bark_key` 表示保持原值；传空字符串表示清除。 */
export function updateReminderSettingsApi(data: Record<string, unknown>) {
  return request<ReminderSettingsResponse>('/reminders/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: 'reminders:settings',
      coalesceKey: 'reminders:settings',
      description: '保存复习提醒设置',
      replayMode: 'auto',
    },
  })
}

export function getReminderStatusApi() {
  return request<ReminderStatus>('/reminders/status')
}

/**
 * 测试通知不进 mutation queue：补发的"测试"到达时已经不代表当下的状态了。
 */
export function sendTestReminderApi() {
  return request<ReminderTestResponse>('/reminders/test', {
    method: 'POST',
    persistence: false,
  })
}

/** 用真实数据按类型发一条样例，用来核对文案。 */
export function previewReminderApi(kind: ReminderKind) {
  return request<ReminderTestResponse>('/reminders/preview', {
    method: 'POST',
    body: JSON.stringify({ kind }),
    persistence: false,
  })
}
