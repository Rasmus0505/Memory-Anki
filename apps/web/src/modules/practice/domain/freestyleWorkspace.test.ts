import { describe, expect, it } from 'vitest'
import {
  FREESTYLE_WORKSPACE_PRIMARY,
  freestyleWorkspaceLabel,
  freestyleWorkspacePath,
  isPalaceReviewWorkspace,
  normalizeFreestyleWorkspaceId,
  palaceReviewPath,
  palaceReviewWorkspaceId,
  parsePalaceReviewWorkspaceId,
} from './freestyleWorkspace'

describe('freestyleWorkspace', () => {
  it('keeps a palace review workspace out of the immersive slots', () => {
    expect(palaceReviewWorkspaceId(23)).toBe('p23')
    expect(isPalaceReviewWorkspace('p23')).toBe(true)
    expect(parsePalaceReviewWorkspaceId('p23')).toBe(23)
    expect(isPalaceReviewWorkspace('primary')).toBe(false)
    expect(normalizeFreestyleWorkspaceId('p23')).toBe(FREESTYLE_WORKSPACE_PRIMARY)
    expect(palaceReviewPath(23, '5')).toBe('/palaces/23/review?subjectId=5')
    expect(palaceReviewPath(23)).toBe('/palaces/23/review')
  })

  it('resolves every workspace id to the single 随心 workspace', () => {
    expect(normalizeFreestyleWorkspaceId('secondary')).toBe(FREESTYLE_WORKSPACE_PRIMARY)
    expect(freestyleWorkspacePath(FREESTYLE_WORKSPACE_PRIMARY)).toBe('/freestyle')
    expect(freestyleWorkspaceLabel(FREESTYLE_WORKSPACE_PRIMARY)).toBe('随心')
  })

})
