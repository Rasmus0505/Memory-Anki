/**
 * Unit-card rating shortcuts. Structurally identical to `UnitRating` but declared
 * here so the model layer stays free of api imports.
 */
export type FreestyleRatingShortcut = 1 | 2 | 3 | 4

/**
 * 1-4 rate the unit under the viewport. Quiz cards read the same digits as choice
 * picks, but the two card types never own the keyboard at the same time — only the
 * active card binds its handler.
 */
export function getFreestyleRatingShortcut(key: string): FreestyleRatingShortcut | null {
  switch (key) {
    case '1':
      return 1
    case '2':
      return 2
    case '3':
      return 3
    case '4':
      return 4
    default:
      return null
  }
}
