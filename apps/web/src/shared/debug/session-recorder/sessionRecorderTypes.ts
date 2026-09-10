export const SESSION_RECORDER_HISTORY_KEY = 'memory-anki.session-recorder.history.v1'
export const SESSION_RECORDER_MAX_HISTORY = 20
export const SESSION_RECORDER_MAX_EVENTS = 500

export type SessionRecorderEventKind =
  | 'session'
  | 'route'
  | 'click'
  | 'menu'
  | 'mindmap'
  | 'doc'
  | 'error'
  | 'ai'

export interface SessionRecorderEvent {
  at: string
  kind: SessionRecorderEventKind
  action: string
  detail: string
}

export interface SessionRecorderSession {
  id: string
  startedAt: string
  endedAt: string | null
  routes: string[]
  events: SessionRecorderEvent[]
  notes: string
  reportText: string
}

export interface SessionRecorderState {
  recording: boolean
  current: SessionRecorderSession | null
  history: SessionRecorderSession[]
  dialogOpen: boolean
  selectedId: string | null
}
