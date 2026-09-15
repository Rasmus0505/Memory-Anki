import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnglishLookupPanel } from './EnglishLookupPanel'
import { LookupAnchor } from './LookupAnchor'
import type { EnglishLookupController } from './useEnglishLookup'
import { LOOKUP_PANEL_WIDTH } from './types'

function openLookup(): EnglishLookupController {
  return {
    panel: {
      open: true,
      pinned: false,
      dragging: false,
      left: 24,
      top: 80,
      width: LOOKUP_PANEL_WIDTH,
      maxHeight: 360,
      query: 'wrestle',
      queryId: 1,
      searchInput: 'wrestle',
      loading: false,
      result: null,
      error: null,
      oxfordHeight: 'HALF',
      bingHeight: 'HALF',
      collinsHeight: 'HALF',
      autoPlayedQueryId: null,
    },
    panelRef: { current: null },
    anchor: null,
    canHistoryBack: false,
    canHistoryForward: false,
    setSearchInput: vi.fn(),
    handleSearchSubmit: vi.fn(),
    togglePin: vi.fn(),
    closePanel: vi.fn(),
    replayAudio: vi.fn(),
    goHistory: vi.fn(),
    cycleCardHeight: vi.fn(),
    setCardHeight: vi.fn(),
    runSearch: vi.fn(),
    playSrc: vi.fn(),
    handleHeaderPointerDown: vi.fn(),
    handleResizePointerDown: vi.fn(),
    handleTokenClick: vi.fn(),
    handleAnchorClick: vi.fn(),
    reset: vi.fn(),
  } as unknown as EnglishLookupController
}

describe('English lookup chrome contrast', () => {
  it('forces foreground text on the light panel so dark shells cannot wash it out', () => {
    render(
      <div className="text-white">
        <EnglishLookupPanel lookup={openLookup()} />
      </div>,
    )
    expect(screen.getByTestId('english-lookup-panel').className).toContain('text-foreground')
  })

  it('forces foreground text on the lookup anchor chip', () => {
    render(
      <div className="text-white">
        <LookupAnchor
          anchor={{ visible: true, left: 12, top: 12, query: 'wrestle' }}
          onClick={() => undefined}
        />
      </div>,
    )
    expect(screen.getByTestId('english-lookup-anchor').className).toContain('text-foreground')
  })
})
