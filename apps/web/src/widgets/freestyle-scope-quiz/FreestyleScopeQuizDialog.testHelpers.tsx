import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import { FreestyleScopeQuizDialog } from './FreestyleScopeQuizDialog'

type DialogProps = Parameters<typeof FreestyleScopeQuizDialog>[0]

export function buildScopeQuizProps(overrides: Partial<DialogProps> = {}): DialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    roundId: 'round-1',
    planVersion: 1,
    storedConfig: DEFAULT_FREESTYLE_FEED_CONFIG,
    setupDone: true,
    roundReviewPalaceCount: 2,
    onConfirmSetup: vi.fn(),
    onRoundSync: vi.fn(),
    ...overrides,
  }
}

export function renderScopeQuizDialog(overrides: Partial<DialogProps> = {}) {
  return render(<FreestyleScopeQuizDialog {...buildScopeQuizProps(overrides)} />)
}
