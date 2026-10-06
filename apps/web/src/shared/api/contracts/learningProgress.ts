/** Read-only coverage of current active palace documents; never a mastery score. */
export interface LearningProgressMetrics {
  /** Current non-root leaf nodes; branch headings and empty palace roots are excluded. */
  memory_total: number
  /** Nodes covered by current review units with effective rating evidence. */
  memory_reviewed: number
  /** Nodes covered by current units due on or before the local calendar day. */
  memory_due: number
  quiz_total: number
  /** Distinct questions with any persisted answer record, including incorrect attempts. */
  quiz_answered: number
}

export interface LearningProgressNode {
  id: string
  name: string
  kind: 'subject' | 'palace' | 'chapter' | 'unit' | 'memory_point'
  palace_id: number | null
  children: LearningProgressNode[]
  metrics: LearningProgressMetrics
}

export interface LearningProgressResponse {
  roots: LearningProgressNode[]
  metrics: LearningProgressMetrics
  generated_at: string
  notes: string[]
}
