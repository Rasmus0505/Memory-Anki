import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetWindowLayoutMemoryForTest, readFloatingDialogMemory } from '@/shared/preferences/windowLayoutMemory'
import { applyRememberedFloatingSize, shouldDeferDialogToCenteredLayout, writeStoredFloatingLayout } from './dialogFloatingLayout'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

describe('dialog floating layout ratios', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
    setViewport(1200, 800)
  })

  afterEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
    setViewport(1024, 768)
  })

  it('keeps a manual width ratio when a smaller viewport is applied', () => {
    const storageKey = 'memory-anki-floating-dialog:ratio'
    writeStoredFloatingLayout(
      storageKey,
      { x: 80, y: 40, width: 900, height: 500, collapsed: false, pinned: false },
      { size: true, position: true },
    )

    setViewport(500, 400)
    const applied = applyRememberedFloatingSize(storageKey, {
      x: 40,
      y: 40,
      width: 200,
      height: 180,
      collapsed: false,
      pinned: true,
    })

    expect(applied.width).toBeLessThan(900)
    expect(applied.pinned).toBe(true)
    expect(readFloatingDialogMemory('ratio')?.widthRatio).toBe(0.75)
    setViewport(1200, 800)
    expect(applyRememberedFloatingSize(storageKey, applied).width).toBe(900)
  })
})

describe('dialog deferring to the centered layout', () => {
  beforeEach(() => {
    setViewport(1825, 982)
  })

  afterEach(() => {
    setViewport(1024, 768)
  })

  it('defers a dialog that asks for a viewport-relative width', () => {
    // 随心配置 / 英语听力设置 类宽面板：max-w-4xl 之类会撞上浮动上限。
    expect(shouldDeferDialogToCenteredLayout({ className: 'max-w-4xl' })).toBe(false)
    expect(shouldDeferDialogToCenteredLayout({ className: 'max-w-2xl' })).toBe(false)
    expect(
      shouldDeferDialogToCenteredLayout({ className: 'max-h-[90vh] max-w-[min(94vw,1220px)] overflow-hidden' }),
    ).toBe(true)
    expect(
      shouldDeferDialogToCenteredLayout({ className: 'h-[min(92vh,980px)] max-w-[min(92vw,1440px)]' }),
    ).toBe(true)
    expect(
      shouldDeferDialogToCenteredLayout({ className: 'w-[min(68rem,calc(100vw-2rem))] max-w-none' }),
    ).toBe(true)
  })

  it('defers when an explicit default width exceeds the floating cap', () => {
    setViewport(1400, 900)
    expect(shouldDeferDialogToCenteredLayout({ requestedWidth: 1600 })).toBe(true)
    expect(shouldDeferDialogToCenteredLayout({ requestedWidth: 900 })).toBe(false)
  })

  it('keeps floating for a dialog that never requested a width', () => {
    // 回归保护：普通弹窗继承 820px 默认宽度，在窄视口下必须继续浮动。
    for (const width of [640, 900, 1200, 1919]) {
      setViewport(width, 800)
      expect(shouldDeferDialogToCenteredLayout({ requestedWidth: null })).toBe(false)
      expect(shouldDeferDialogToCenteredLayout({})).toBe(false)
      expect(shouldDeferDialogToCenteredLayout({ className: 'max-w-md' })).toBe(false)
    }
  })
})
