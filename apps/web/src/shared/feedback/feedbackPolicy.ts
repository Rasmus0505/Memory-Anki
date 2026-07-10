export type SemanticFeedbackKind =
  | 'operation_success'
  | 'operation_error'
  | 'task_complete'
  | 'task_error'
  | 'quiz_correct'
  | 'quiz_incorrect'
  | 'milestone'
  | 'completion'
  | 'reminder'

export type FeedbackVisibility = 'local' | 'global' | 'background'

export interface SemanticFeedbackEvent {
  kind: SemanticFeedbackKind
  visibility?: FeedbackVisibility
}

export interface FeedbackPolicyDecision {
  surface: 'inline' | 'task' | 'toast' | 'learning' | 'achievement' | 'completion' | 'reminder'
  tone: 'neutral' | 'success' | 'warning' | 'error' | 'achievement'
  audio: 'none' | 'success' | 'error' | 'quiz_correct' | 'quiz_incorrect' | 'milestone' | 'completion' | 'reminder'
  celebration: 'none' | 'milestone' | 'completion'
}

export function resolveFeedbackPolicy(event: SemanticFeedbackEvent): FeedbackPolicyDecision {
  const visibility = event.visibility ?? 'local'

  if (event.kind === 'operation_success') {
    return {
      surface: visibility === 'local' ? 'inline' : 'toast',
      tone: 'success',
      audio: 'none',
      celebration: 'none',
    }
  }
  if (event.kind === 'operation_error') {
    return {
      surface: visibility === 'local' ? 'inline' : 'toast',
      tone: 'error',
      audio: visibility === 'local' ? 'none' : 'error',
      celebration: 'none',
    }
  }
  if (event.kind === 'task_complete' || event.kind === 'task_error') {
    return {
      surface: visibility === 'background' ? 'toast' : 'task',
      tone: event.kind === 'task_error' ? 'error' : 'success',
      audio: visibility === 'background' ? (event.kind === 'task_error' ? 'error' : 'success') : 'none',
      celebration: 'none',
    }
  }
  if (event.kind === 'quiz_correct' || event.kind === 'quiz_incorrect') {
    return {
      surface: 'learning',
      tone: event.kind === 'quiz_correct' ? 'success' : 'error',
      audio: event.kind,
      celebration: 'none',
    }
  }
  if (event.kind === 'milestone') {
    return {
      surface: 'achievement',
      tone: 'achievement',
      audio: 'milestone',
      celebration: 'milestone',
    }
  }
  if (event.kind === 'completion') {
    return {
      surface: 'completion',
      tone: 'success',
      audio: 'completion',
      celebration: 'completion',
    }
  }
  return {
    surface: 'reminder',
    tone: 'warning',
    audio: 'reminder',
    celebration: 'none',
  }
}
