/** Pure mapping from app feedback events to commands the city iframe understands. */
export type CityCommand =
  | { type: 'flip' }
  | { type: 'rating'; level: 1 | 2 | 3 | 4 }
  | { type: 'quiz'; correct: boolean }
  | { type: 'pin' }
  | { type: 'structure' }
  | { type: 'detail' }
  | { type: 'highlight' }
  | { type: 'celebrate' }

export function cityCommandForFeedback(event: string): CityCommand | null {
  switch (event) {
    case 'grade_forget':
      return { type: 'rating', level: 1 }
    case 'grade_hard':
      return { type: 'rating', level: 2 }
    case 'grade_good':
      return { type: 'rating', level: 3 }
    case 'grade_easy':
      return { type: 'rating', level: 4 }
    case 'quiz_result_correct':
      return { type: 'quiz', correct: true }
    case 'quiz_result_incorrect':
      return { type: 'quiz', correct: false }
    case 'node_create':
      return { type: 'pin' }
    case 'node_delete':
    case 'node_move':
    case 'import_apply':
      return { type: 'structure' }
    case 'text_commit':
    case 'save_success':
      return { type: 'detail' }
    default:
      return null
  }
}

export const CITY_EDIT_COMMANDS = new Set<CityCommand['type']>([
  'pin',
  'structure',
  'detail',
  'highlight',
])
