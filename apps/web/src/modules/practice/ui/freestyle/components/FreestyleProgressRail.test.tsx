import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFreestyleScrollChannel } from '@/modules/practice/ui/freestyle/model/freestyleScrollChannel'
import {
  palaceAccent,
  palaceAccentToneClass,
  progressSegmentShapeClass,
  retryNodeToneClass,
  type FreestyleProgressSummary,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { FreestyleProgressRail } from './FreestyleProgressRail'

function summary(overrides: Partial<FreestyleProgressSummary> = {}): FreestyleProgressSummary {
  return {
    segments: [
      { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false, kind: 'source', sourceLabel: 'one' },
      { cardId: 'two', tone: 'retry', palaceId: 1, palaceDone: false, kind: 'source', sourceLabel: 'two', waitingRetry: true },
      { cardId: 'three', tone: 'current', palaceId: 2, palaceDone: false, kind: 'source', sourceLabel: 'three' },
      { cardId: 'four', tone: 'pending', palaceId: 2, palaceDone: false, kind: 'source', sourceLabel: 'four' },
    ],
    position: 3,
    total: 4,
    doneCount: 1,
    retryCount: 1,
    scheduledBase: 4,
    positionBase: 3,
    retryInserted: 0,
    passedCount: 1,
    ...overrides,
  }
}

function renderRail(overrides: Partial<Parameters<typeof FreestyleProgressRail>[0]> = {}) {
  const onOpenPlan = vi.fn()
  const props = {
    summary: summary(),
    onOpenPlan,
    ...overrides,
  }
  render(
    <TooltipProvider>
      <FreestyleProgressRail {...props} />
    </TooltipProvider>,
  )
  return { onOpenPlan }
}

describe('FreestyleProgressRail', () => {
  it('draws one segment per card so restudy re-insertion stays visible', () => {
    renderRail()

    const segments = screen.getAllByTestId('freestyle-progress-segment')
    expect(segments).toHaveLength(4)
    expect(segments.map((node) => node.getAttribute('data-tone')))
      .toEqual(['done', 'retry', 'current', 'pending'])
    expect(segments[0].className).toContain(progressSegmentShapeClass('done'))
    expect(segments[2].className).toContain(progressSegmentShapeClass('current', true))
    expect(segments[3].className).toContain(progressSegmentShapeClass('pending'))
    expect(screen.getByTestId('freestyle-progress-rail').className).toContain('h-7')
  })

  it('colors segments by palace identity, not a whole-palace emerald override', () => {
    renderRail({
      summary: summary({
        segments: [
          { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: true },
          { cardId: 'two', tone: 'done', palaceId: 1, palaceDone: true },
          { cardId: 'three', tone: 'current', palaceId: 2, palaceDone: false },
          { cardId: 'four', tone: 'pending', palaceId: 2, palaceDone: false },
          { cardId: 'five', tone: 'pending', palaceId: null, palaceDone: false },
        ],
      }),
    })

    const segments = screen.getAllByTestId('freestyle-progress-segment')
    expect(segments.map((node) => node.getAttribute('data-palace-id')))
      .toEqual(['1', '1', '2', '2', ''])

    expect(palaceAccent(1)).not.toBe(palaceAccent(2))
    expect(palaceAccent(null)).toBe('neutral')

    // Same palace + same tone → identical fill class.
    expect(segments[0].className).toContain(palaceAccentToneClass(1, 'done'))
    expect(segments[1].className).toContain(palaceAccentToneClass(1, 'done'))
    expect(segments[0].className).toBe(segments[1].className)

    // Different palaces keep distinct accents even when tones match.
    expect(segments[3].className).toContain(palaceAccentToneClass(2, 'pending'))
    expect(palaceAccentToneClass(1, 'pending')).not.toBe(palaceAccentToneClass(2, 'pending'))

    // Done no longer forces emerald via palaceDone.
    expect(segments[0].className).not.toContain('bg-emerald-400')
    expect(segments[4].className).toContain(palaceAccentToneClass(null, 'pending'))

    // Faint pending vs solid done must stay a glanceable contrast on 6px ticks.
    expect(palaceAccentToneClass(2, 'pending')).toContain('/25')
    expect(palaceAccentToneClass(1, 'done')).not.toMatch(/\/\d+/)
    expect(segments[3].className).toContain('/25')
    expect(segments[0].className).not.toMatch(/bg-\S+\/\d+/)
  })

  it('speaks the counts the decorative rail cannot', () => {
    renderRail()

    const label = '本轮进度 3/4。点击查看本轮安排'
    const rail = screen.getByTestId('freestyle-progress-rail')
    expect(rail.getAttribute('aria-label')).toBe(label)
    expect(rail.getAttribute('title')).toBeNull()
    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('3/4')
    expect(screen.getByTestId('freestyle-progress-hud').getAttribute('title')).toBeNull()
  })

  it('names the hovered tick as that card, not the card currently on screen', () => {
    renderRail()

    expect(screen.getByLabelText('1/4 · 《one》 · 已过')).toBeTruthy()
    expect(screen.getByLabelText('2/4 · 《two》 · 稍后重练')).toBeTruthy()
    expect(screen.getByLabelText('3/4 · 《three》 · 当前')).toBeTruthy()
    expect(screen.getByLabelText('4/4 · 《four》 · 待练')).toBeTruthy()
  })

  it('uses the live feed length including restudy insertions as the HUD denominator', () => {
    renderRail({
      summary: summary({
        retryInserted: 1,
        scheduledBase: 4,
        positionBase: 3,
        passedCount: 1,
      }),
    })

    const label = '本轮进度 3/4。点击查看本轮安排'
    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('3/4')
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('aria-label')).toBe(label)
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('title')).toBeNull()
    expect(screen.getByTestId('freestyle-progress-hud').getAttribute('title')).toBeNull()
  })

  it('renders retry occurrences as numbered amber circles', () => {
    renderRail({
      summary: summary({
        segments: [
          { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false, kind: 'source' },
          {
            cardId: 'retry:round-1:one:2',
            tone: 'retry',
            palaceId: 1,
            palaceDone: false,
            kind: 'retry',
            retryAttempt: 2,
            sourceCardId: 'one',
            sourceLabel: 'one',
          },
          { cardId: 'two', tone: 'current', palaceId: 1, palaceDone: false, kind: 'source' },
        ],
        retryInserted: 1,
        scheduledBase: 2,
        positionBase: 2,
        position: 2,
        total: 3,
        passedCount: 1,
      }),
    })

    const node = screen.getByTestId('freestyle-progress-retry-node')
    expect(node.textContent).toBe('2')
    expect(node.getAttribute('aria-label')).toBe('2/3 · 重练《one》第 2 次 · 待重练')
    expect(node.getAttribute('title')).toBeNull()
    expect(node.className).toContain('rounded-full')
    expect(node.className).toContain(retryNodeToneClass('retry'))
    expect(screen.getAllByTestId('freestyle-progress-segment')).toHaveLength(2)
    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('2/3')
  })

  it('collapses distant retry counts into ticks when the round no longer fits', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(96)
    try {
      const segments = Array.from({ length: 12 }, (_, index) => ({
        cardId: `retry-${index}`,
        tone: index === 5 ? 'current' as const : 'retry' as const,
        palaceId: 1,
        palaceDone: false,
        kind: 'retry' as const,
        retryAttempt: index === 5 ? 7 : index + 1,
        viewing: index === 5,
        sourceLabel: '卡',
      }))
      renderRail({
        summary: summary({
          segments,
          position: 6,
          total: 12,
          retryInserted: 12,
          scheduledBase: 1,
        }),
      })

      const rail = screen.getByTestId('freestyle-progress-rail')
      expect(rail.getAttribute('data-compact')).toBe('true')
      expect(rail.className).toContain('overflow-hidden')
      const nodes = screen.getAllByTestId('freestyle-progress-retry-node')
      expect(nodes).toHaveLength(12)
      expect(nodes.map((node) => node.getAttribute('data-count-visible'))).toEqual([
        'false', 'false', 'false', 'true', 'true', 'true', 'true', 'true', 'false', 'false', 'false', 'false',
      ])
      expect(nodes[5].textContent).toBe('7')
      expect(nodes[3].textContent).toBe('4')
      expect(nodes[0].textContent).toBe('')
      expect(nodes[0].className).not.toContain('rounded-full')
      expect(nodes[0].className).toContain(retryNodeToneClass('retry'))
      expect(screen.getByLabelText('1/12 · 重练《卡》第 1 次 · 待重练')).toBeTruthy()
      expect(screen.getByLabelText('6/12 · 重练《卡》第 7 次 · 当前')).toBeTruthy()
    } finally {
      width.mockRestore()
    }
  })

  it('fills a completed retry node solid and leaves an unfinished retry faint', () => {
    renderRail({
      summary: summary({
        segments: [
          {
            cardId: 'retry:round-1:one:1',
            tone: 'done',
            palaceId: 1,
            palaceDone: false,
            kind: 'retry',
            retryAttempt: 1,
            sourceCardId: 'one',
            sourceLabel: 'one',
          },
          {
            cardId: 'retry:round-1:two:2',
            tone: 'retry',
            palaceId: 2,
            palaceDone: false,
            kind: 'retry',
            retryAttempt: 2,
            sourceCardId: 'two',
            sourceLabel: 'two',
          },
        ],
        retryInserted: 2,
        scheduledBase: 1,
        positionBase: 1,
        passedCount: 1,
      }),
    })

    const nodes = screen.getAllByTestId('freestyle-progress-retry-node')
    expect(nodes[0].className).toContain(retryNodeToneClass('done'))
    expect(nodes[1].className).toContain(retryNodeToneClass('retry'))
    expect(nodes[0].getAttribute('aria-label')).toBe('1/2 · 重练《one》第 1 次 · 已过')
    expect(nodes[1].getAttribute('aria-label')).toBe('2/2 · 重练《two》第 2 次 · 待重练')
  })

  it('keeps a rated viewing tick taller than other done ticks', () => {
    renderRail({
      summary: summary({
        segments: [
          { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false, viewing: true, kind: 'source', sourceLabel: 'one' },
          { cardId: 'two', tone: 'done', palaceId: 1, palaceDone: false, viewing: false, kind: 'source', sourceLabel: 'two' },
        ],
        position: 1,
        positionBase: 1,
        doneCount: 2,
        passedCount: 2,
      }),
    })

    const segments = screen.getAllByTestId('freestyle-progress-segment')
    expect(segments[0].getAttribute('data-viewing')).toBe('true')
    expect(segments[0].className).toContain(progressSegmentShapeClass('done', true))
    expect(segments[1].getAttribute('data-viewing')).toBe('false')
    expect(segments[1].className).toContain(progressSegmentShapeClass('done'))
    expect(screen.getByLabelText('1/2 · 《one》 · 当前 · 已过')).toBeTruthy()
  })

  it('opens the round plan from the rail', () => {
    const { onOpenPlan } = renderRail()

    fireEvent.click(screen.getByTestId('freestyle-progress-rail'))
    expect(onOpenPlan).toHaveBeenCalledTimes(1)
  })

  it('jumps to the clicked tick instead of opening the plan', () => {
    const onJump = vi.fn()
    const { onOpenPlan } = renderRail({ onJump })

    fireEvent.click(screen.getByLabelText('4/4 · 《four》 · 待练'))
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(onJump).toHaveBeenCalledWith('four')
    expect(onOpenPlan).not.toHaveBeenCalled()
  })

  it('jumps to a retry occurrence from its tick', () => {
    const onJump = vi.fn()
    renderRail({
      onJump,
      summary: summary({
        segments: [
          { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false, kind: 'source', sourceLabel: 'one' },
          {
            cardId: 'retry:round-1:one:2',
            tone: 'retry',
            palaceId: 1,
            palaceDone: false,
            kind: 'retry',
            retryAttempt: 2,
            sourceCardId: 'one',
            sourceLabel: 'one',
          },
        ],
        position: 2,
        total: 2,
      }),
    })

    fireEvent.click(screen.getByTestId('freestyle-progress-retry-node'))
    expect(onJump).toHaveBeenCalledWith('retry:round-1:one:2')
  })

  it('still opens the plan from the HUD count when ticks can jump', () => {
    const onJump = vi.fn()
    const { onOpenPlan } = renderRail({ onJump })

    fireEvent.click(screen.getByTestId('freestyle-progress-hud'))
    expect(onOpenPlan).toHaveBeenCalledTimes(1)
    expect(onJump).not.toHaveBeenCalled()
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('aria-label'))
      .toBe('本轮进度 3/4。点击分段跳转到对应卡片')
  })

  it('opens the plan from an empty rail even when jump is wired', () => {
    const onJump = vi.fn()
    const { onOpenPlan } = renderRail({
      onJump,
      summary: summary({
        segments: [],
        position: 0,
        total: 0,
        doneCount: 0,
        retryCount: 0,
        scheduledBase: 0,
        positionBase: 0,
        retryInserted: 0,
        passedCount: 0,
      }),
    })

    fireEvent.click(screen.getByTestId('freestyle-progress-rail'))
    expect(onOpenPlan).toHaveBeenCalledTimes(1)
    expect(onJump).not.toHaveBeenCalled()
  })

  it('renders an empty rail without segments for an empty round', () => {
    renderRail({
      summary: summary({
        segments: [],
        position: 0,
        total: 0,
        doneCount: 0,
        retryCount: 0,
        scheduledBase: 0,
        positionBase: 0,
        retryInserted: 0,
        passedCount: 0,
      }),
    })

    expect(screen.queryAllByTestId('freestyle-progress-segment')).toHaveLength(0)
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('aria-label'))
      .toBe('本轮暂无安排。点击查看本轮安排')
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('title')).toBeNull()
  })

  it('does not show a session timer on the HUD', () => {
    renderRail()
    expect(screen.queryByTestId('freestyle-timer-dot')).toBeNull()
  })

  describe('finger follow', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    function stubLayout() {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(performance.now())
        return 1
      })
      vi.stubGlobal('cancelAnimationFrame', () => {})
      const order = ['one', 'two', 'three', 'four']
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const index = order.indexOf(this.dataset.railSlot ?? '')
        const left = index >= 0 ? index * 40 : 0
        const width = index >= 0 ? 30 : 400
        return { left, right: left + width, width, top: 0, bottom: 10, height: 10, x: left, y: 0, toJSON() {} } as DOMRect
      })
    }

    it('slides the glider between the leaving and entering tick as frames arrive', () => {
      stubLayout()
      const channel = createFreestyleScrollChannel()
      renderRail({ scrollChannel: channel })
      const glider = screen.getByTestId('freestyle-progress-glider')

      act(() => channel.publish({ fromCardId: 'three', toCardId: 'four', t: 0.25, settled: false }))
      expect(glider.className).toContain('progress-glider-follow')
      expect(glider.style.transform).toBe('translateX(90px) scaleX(0.3)')

      act(() => channel.publish({ fromCardId: 'three', toCardId: 'four', t: 0.75, settled: false }))
      expect(glider.style.transform).toBe('translateX(110px) scaleX(0.3)')
      expect(glider.dataset.direction).toBe('forward')
      const entering = document.querySelector<HTMLElement>('[data-rail-slot="four"]')
      expect(entering?.dataset.follow).toBe('to')
      expect(entering?.style.getPropertyValue('--fs-follow')).toBe('0.75')
    })

    it('releases control back to the playhead once the scroll settles', () => {
      stubLayout()
      const channel = createFreestyleScrollChannel()
      renderRail({ scrollChannel: channel })
      const glider = screen.getByTestId('freestyle-progress-glider')

      act(() => channel.publish({ fromCardId: 'three', toCardId: 'four', t: 0.5, settled: false }))
      act(() => channel.publish({ fromCardId: 'four', toCardId: null, t: 0, settled: true }))

      expect(glider.className).not.toContain('progress-glider-follow')
      expect(glider.className).toContain('progress-glider-release')
      expect(document.querySelector('[data-follow]')).toBeNull()
    })
  })

  describe('motion', () => {
    type Seg = FreestyleProgressSummary['segments'][number]
    const seg = (cardId: string, tone: Seg['tone'], extra: Partial<Seg> = {}): Seg => ({
      cardId, tone, palaceId: 1, palaceDone: false, kind: 'source', sourceLabel: cardId, ...extra,
    })
    function mountRail(segments: Seg[]) {
      const view = render(
        <TooltipProvider>
          <FreestyleProgressRail summary={summary({ segments, total: segments.length })} onOpenPlan={() => {}} />
        </TooltipProvider>,
      )
      return (next: Seg[]) => view.rerender(
        <TooltipProvider>
          <FreestyleProgressRail summary={summary({ segments: next, total: next.length })} onOpenPlan={() => {}} />
        </TooltipProvider>,
      )
    }

    it('sweeps the palace fill in from the left when a tick becomes done', () => {
      const update = mountRail([seg('one', 'pending', { viewing: true }), seg('two', 'pending')])
      update([seg('one', 'done'), seg('two', 'pending', { viewing: true })])

      const first = screen.getAllByTestId('freestyle-progress-segment')[0]
      expect(first.querySelector('.progress-fill-sweep')).not.toBeNull()
      // Base stays faint underneath so the sweep is visible.
      expect(first.className).toContain(palaceAccentToneClass(1, 'pending'))
    })

    it('opens a slot for a retry occurrence inserted into a drawn rail', () => {
      const update = mountRail([seg('one', 'done'), seg('two', 'pending', { viewing: true })])
      update([
        seg('one', 'done'),
        seg('retry:round-1:one:1', 'retry', { kind: 'retry', retryAttempt: 1, sourceCardId: 'one' }),
        seg('two', 'pending', { viewing: true }),
      ])

      const node = screen.getByTestId('freestyle-progress-retry-node')
      expect(node.className).toContain('progress-retry-insert')
      expect(node.parentElement?.className).toMatch(/progress-slot-open-/)
    })

    it('does not treat the first render as an insertion', () => {
      mountRail([
        seg('one', 'done'),
        seg('retry:round-1:one:1', 'retry', { kind: 'retry', retryAttempt: 1, sourceCardId: 'one' }),
      ])
      expect(screen.getByTestId('freestyle-progress-retry-node').className).not.toContain('progress-retry-insert')
    })

    it('sweeps a sheen over a palace that just cleared', () => {
      const update = mountRail([
        seg('one', 'done'),
        seg('two', 'pending', { viewing: true }),
        seg('three', 'pending', { palaceId: 2 }),
      ])
      expect(screen.queryAllByTestId('freestyle-progress-sheen')).toHaveLength(0)
      update([
        seg('one', 'done', { palaceDone: true }),
        seg('two', 'done', { palaceDone: true }),
        seg('three', 'pending', { palaceId: 2, viewing: true }),
      ])

      const sheens = screen.getAllByTestId('freestyle-progress-sheen')
      expect(sheens).toHaveLength(1)
      expect(sheens[0].getAttribute('data-kind')).toBe('palace')
    })

    it('plays the round finale when the last card is done', () => {
      const update = mountRail([seg('one', 'done'), seg('two', 'pending', { viewing: true })])
      update([seg('one', 'done', { palaceDone: true }), seg('two', 'done', { palaceDone: true, viewing: true })])

      const sheens = screen.getAllByTestId('freestyle-progress-sheen')
      expect(sheens.map((node) => node.getAttribute('data-kind'))).toEqual(['round'])
      expect(screen.getByTestId('freestyle-progress-rail').className).toContain('progress-round-glow')
    })
  })
})
