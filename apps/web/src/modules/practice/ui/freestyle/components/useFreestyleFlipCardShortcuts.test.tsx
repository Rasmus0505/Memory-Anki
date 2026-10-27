import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapSelection } from '@/modules/content/public'
import type { RevealState } from '@/modules/memory/public'
import {
  useFreestyleFlipCardShortcuts,
  type FreestyleFlipRevealApi,
} from './useFreestyleFlipCardShortcuts'

function buildApi(overrides: Partial<FreestyleFlipRevealApi> = {}): FreestyleFlipRevealApi {
  return {
    revealMap: {} as Record<string, RevealState>,
    applyTargetRevealFrom: vi.fn(() => ({ nextRevealMap: {}, changedIds: ['unit-node'] })),
    retractTarget: vi.fn(() => true),
    handleBulkRevealSubtree: vi.fn(() => true),
    handleBulkRevealDirectChildren: vi.fn(() => true),
    handleNodeContextMenu: vi.fn(),
    ...overrides,
  }
}

function Harness({
  active,
  isEditMode = false,
  api,
}: {
  active: boolean
  isEditMode?: boolean
  api: FreestyleFlipRevealApi
}) {
  const follow = useFreestyleFlipCardShortcuts({
    active,
    isEditMode,
    palaceTitle: '测试宫殿',
    unitTitle: '当前单元',
    anchorUid: 'unit-node',
    revealApiRef: { current: api },
  })
  return <span data-testid="follow-nonce">{follow.nonce}</span>
}

function press(key: string, code: string) {
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('useFreestyleFlipCardShortcuts', () => {
  beforeEach(() => window.localStorage.clear())

  it('releases a unit-switch control focus when a card takes over', () => {
    const api = buildApi()
    const view = render(<Harness active={false} api={api} />)
    const pagerButton = document.createElement('button')
    pagerButton.type = 'button'
    document.body.appendChild(pagerButton)
    try {
      pagerButton.focus()
      expect(document.activeElement).toBe(pagerButton)

      view.rerender(<Harness active api={api} />)

      expect(document.activeElement).not.toBe(pagerButton)
    } finally {
      pagerButton.remove()
    }
  })

  it('flips the unit anchor on Enter and asks the camera to follow', () => {
    const api = buildApi()
    const view = render(<Harness active api={api} />)

    const event = press('Enter', 'Enter')

    expect(event.defaultPrevented).toBe(true)
    const [baseMap, nodes] = vi.mocked(api.applyTargetRevealFrom).mock.calls[0]
    expect(baseMap).toBe(api.revealMap)
    expect((nodes as MindMapSelection[])[0].uid).toBe('unit-node')
    expect(view.getByTestId('follow-nonce').textContent).toBe('1')
  })

  it('retracts the current card on Backspace without following the camera', () => {
    const api = buildApi()
    const view = render(<Harness active api={api} />)

    press('Backspace', 'Backspace')

    const [nodes] = vi.mocked(api.retractTarget).mock.calls[0]
    expect((nodes as MindMapSelection[])[0].uid).toBe('unit-node')
    expect(view.getByTestId('follow-nonce').textContent).toBe('0')
  })

  it('leaves the keyboard alone while inline editing', () => {
    const api = buildApi()
    render(<Harness active isEditMode api={api} />)

    press('Enter', 'Enter')

    expect(api.applyTargetRevealFrom).not.toHaveBeenCalled()
  })
})
