import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readArticleScrollPosition, useArticleScrollPosition } from './useArticleScrollPosition'

function rectangle(top: number, height: number) {
  return { top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top, toJSON() {} } as DOMRect
}
function fixture() {
  const root = document.createElement('div')
  document.body.append(root)
  Object.defineProperty(root, 'clientHeight', { value: 400 })
  Object.defineProperty(root, 'clientWidth', { value: 400 })
  root.getBoundingClientRect = () => rectangle(100, 400)
  root.scrollTo = vi.fn()
  const add = (uid: string, top: number, height: number) => {
    const section = document.createElement('section')
    section.dataset.articleUid = uid
    section.getBoundingClientRect = () => rectangle(top, height)
    root.append(section)
    return section
  }
  return { root, add, rootRef: { current: root } }
}

describe('article scroll position', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })
  it('finds nearest among all visible blocks and fractional position', () => {
    const { root, add } = fixture()
    add('above', -300, 200)
    add('current', 0, 200)
    add('next', 200, 300)
    expect(readArticleScrollPosition(root)).toEqual({ node_uid: 'current', block_offset: 0.5 })
    root.querySelector('[data-article-uid="current"]')?.remove()
    expect(readArticleScrollPosition(root)).toEqual({ node_uid: 'next', block_offset: 0 })
  })
  it('does not persist initial/layout scroll or selection changes, but records actual user scroll', async () => {
    const { root, rootRef, add } = fixture()
    add('current', 0, 200)
    const recordProgress = vi.fn()
    const { rerender } = renderHook(({ selectedUid }) => useArticleScrollPosition({ active: true, ownerId: 'palace:1', rootRef, selectedUid, recordProgress }), { initialProps: { selectedUid: null as string | null } })
    fireEvent.scroll(root)
    rerender({ selectedUid: 'current' })
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(recordProgress).not.toHaveBeenCalled()
    fireEvent.wheel(root)
    fireEvent.scroll(root)
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(recordProgress).toHaveBeenCalledWith('current', 0.5)
  })
  it('restores fraction after unfolding and records explicit navigation once', async () => {
    const { root, rootRef, add } = fixture()
    root.scrollTop = 100
    const recordProgress = vi.fn()
    const onSelect = vi.fn()
    const { result } = renderHook(() => useArticleScrollPosition({ active: true, ownerId: 'palace:1', rootRef, recordProgress, onSelect, onBeforeNavigate: () => { add('folded', 300, 400) } }))
    act(() => result.current.navigateTo('folded', 0.5))
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'instant' })
    expect(onSelect).toHaveBeenCalledWith('folded')
    expect(recordProgress).toHaveBeenCalledExactlyOnceWith('folded', 0.5)
    fireEvent.scroll(root)
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(recordProgress).toHaveBeenCalledTimes(1)
  })
  it('cancels navigation across owners and ignores inactive workspace scrolls', async () => {
    const { root, rootRef, add } = fixture()
    add('current', 0, 200)
    const recordProgress = vi.fn()
    const { result, rerender } = renderHook(({ ownerId, active }) => useArticleScrollPosition({ active, ownerId, rootRef, recordProgress }), { initialProps: { ownerId: 'palace:1' as 'palace:1' | 'palace:2', active: true } })
    act(() => result.current.navigateTo('current', 0.2))
    rerender({ ownerId: 'palace:2', active: false })
    fireEvent.wheel(root)
    fireEvent.scroll(root)
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(root.scrollTo).not.toHaveBeenCalled()
    expect(recordProgress).not.toHaveBeenCalled()
    rerender({ ownerId: 'palace:2', active: true })
    fireEvent.scroll(root)
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(recordProgress).not.toHaveBeenCalled()
  })
})
