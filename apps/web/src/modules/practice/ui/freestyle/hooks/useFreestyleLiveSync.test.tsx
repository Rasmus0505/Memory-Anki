import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useFreestyleLiveMirror } from '@/modules/practice/ui/freestyle/hooks/useFreestyleLiveMirror'
import { useFreestyleLiveSync } from '@/modules/practice/ui/freestyle/hooks/useFreestyleLiveSync'

const captured = vi.hoisted(() => ({
  last: null as Parameters<typeof useFreestyleLiveMirror>[0] | null,
}))

vi.mock('@/modules/practice/ui/freestyle/hooks/useFreestyleLiveMirror', () => ({
  useFreestyleLiveMirror: (args: Parameters<typeof useFreestyleLiveMirror>[0]) => {
    captured.last = args
  },
}))

const STORAGE_KEY = 'memory-anki.freestyle.reveal-map.v1'

function buildProps() {
  return {
    fullPath: '/freestyle',
    entryPalaceId: 1,
    isActive: true,
    cards: [],
    currentIndex: 0,
    currentCard: { id: 'unit-1' },
    roundComplete: false,
    visualIndex: 0,
    viewingCompleteSlot: false,
    planVersion: 1,
    queueState: { roundId: 'round-1', unitEncountersByCardId: {} },
    navigateToIndex: vi.fn(),
    progress: { questionStates: {} },
    updateQuestionState: vi.fn(),
    adoptRoundVersion: vi.fn(),
    updateUnitEncounter: vi.fn(),
    completeCardBatch: vi.fn(),
    hydrateLiveRound: vi.fn(),
  } as unknown as Parameters<typeof useFreestyleLiveSync>[0]
}

describe('useFreestyleLiveSync', () => {
  beforeEach(() => {
    captured.last = null
    window.localStorage.clear()
  })

  it('never seeds a card from a stored flip ladder', () => {
    // A previous build persisted reveal maps per card; opening a card later must
    // not resurrect that ladder, so the live view carries no reveal state.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'unit-1': { root: 'revealed', child: 'revealed' } }),
    )

    renderHook(() => useFreestyleLiveSync(buildProps()))

    expect(captured.last?.revealMap).toBeNull()
  })

  it('never writes a flip ladder to storage', () => {
    renderHook(() => useFreestyleLiveSync(buildProps()))

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
