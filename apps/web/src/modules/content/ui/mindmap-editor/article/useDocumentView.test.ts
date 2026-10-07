import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDocumentView } from './useDocumentView'

const OWNER = 'palace:55'
const KEY = `memory-anki.document-view.${OWNER}`

describe('useDocumentView', () => {
  afterEach(() => {
    window.localStorage.removeItem(KEY)
  })

  it('forces the map view while the switch is hidden', () => {
    // The <=640px default preference is `article`; hidden-switch hosts must not
    // honour it, or the user is stuck with no control to get back.
    window.localStorage.setItem(KEY, 'article')

    const { result } = renderHook(() => useDocumentView(OWNER, true))

    expect(result.current.documentView).toBe('mindmap')
    expect(result.current.canSwitchDocumentView).toBe(false)
  })

  it('restores the persisted view once the host shows the switch again', () => {
    window.localStorage.setItem(KEY, 'article')

    const { result } = renderHook(() => useDocumentView(OWNER, false))

    expect(result.current.canSwitchDocumentView).toBe(true)
    expect(result.current.documentView).toBe('article')
  })

  it('persists an explicit switch so it survives a remount', () => {
    const first = renderHook(() => useDocumentView(OWNER, false))

    act(() => first.result.current.switchDocumentView('article'))
    expect(first.result.current.documentView).toBe('article')
    expect(window.localStorage.getItem(KEY)).toBe('article')

    first.unmount()
    expect(renderHook(() => useDocumentView(OWNER, false)).result.current.documentView).toBe('article')
  })

  it('resolves the reading owner from the view scope', () => {
    expect(renderHook(() => useDocumentView(OWNER, false)).result.current.articleOwnerId).toBe(OWNER)
    expect(renderHook(() => useDocumentView(null, false)).result.current.articleOwnerId).toBeNull()
  })
})
