import type {
  MindMapFeedbackEvent,
  MindMapFeedbackLevel,
  MindMapFeedbackOrigin,
} from '@/shared/components/mindmap-host/hostBridgeUtils'

export type FeedbackVisualKind =
  | 'tap'
  | 'confirm'
  | 'focus'
  | 'navigation'
  | 'toggle'
  | 'shortcut'
  | 'hover'
  | 'edit'
  | 'create'
  | 'danger'
  | 'reward'
  | 'link'
  | 'segment'
  | 'move'
  | 'mode'

export interface FeedbackDescriptor {
  audioEvent: MindMapFeedbackEvent
  visualKind: FeedbackVisualKind
  level: MindMapFeedbackLevel
  origin: MindMapFeedbackOrigin
  audioScope?: 'local' | 'global'
  hue: number
  size: number
  label?: string
  screenPulse?: 'soft' | 'navigation' | 'celebration'
}

export interface FeedbackBurst {
  id: number
  x: number
  y: number
  descriptor: FeedbackDescriptor
}
