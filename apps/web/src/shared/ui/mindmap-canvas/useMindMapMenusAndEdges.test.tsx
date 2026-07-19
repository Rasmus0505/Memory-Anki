import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import type { Node } from '@xyflow/react'
import { useMindMapMenusAndEdges } from './useMindMapMenusAndEdges'

function makeNode(id: string): Node {
  return { id, position: { x: 0, y: 0 }, data: {}, type: 'mindmap' }
}

function makeClickEvent(detail: number, options?: { ctrlKey?: boolean }): MouseEvent {
  return {
    detail,
    clientX: 10,
    clientY: 20,
    ctrlKey: options?.ctrlKey ?? false,
    metaKey: false,
  } as MouseEvent
}

describe('useMindMapMenusAndEdges node click multi-detail', () => {
  it('allows rapid multi-click activate in readonly flip-card mode (detail > 1)', () => {
    const onNodeSelect = vi.fn()
    const onNodeActivate = vi.fn()
    const { result } = renderHook(() =>
      useMindMapMenusAndEdges({
        onNodeSelect,
        onNodeActivate,
        mobileGuidedActive: false,
        contextActionOnly: false,
        nodeClickViewportPolicy: 'preserve',
        centerNodeInCanvas: vi.fn(),
        readonly: true,
      }),
    )

    const node = makeNode('parent')
    act(() => {
      result.current.handleNodeClick(makeClickEvent(1), node)
      result.current.handleNodeClick(makeClickEvent(2), node)
      result.current.handleNodeClick(makeClickEvent(3), node)
    })

    expect(onNodeActivate).toHaveBeenCalledTimes(3)
    expect(onNodeActivate).toHaveBeenNthCalledWith(1, 'parent')
    expect(onNodeActivate).toHaveBeenNthCalledWith(2, 'parent')
    expect(onNodeActivate).toHaveBeenNthCalledWith(3, 'parent')
  })

  it('still ignores detail > 1 in edit mode so dblclick-to-edit is not swallowed', () => {
    const onNodeSelect = vi.fn()
    const onNodeActivate = vi.fn()
    const { result } = renderHook(() =>
      useMindMapMenusAndEdges({
        onNodeSelect,
        onNodeActivate,
        mobileGuidedActive: false,
        contextActionOnly: false,
        nodeClickViewportPolicy: 'preserve',
        centerNodeInCanvas: vi.fn(),
        readonly: false,
      }),
    )

    const node = makeNode('edit-node')
    act(() => {
      result.current.handleNodeClick(makeClickEvent(1), node)
      result.current.handleNodeClick(makeClickEvent(2), node)
    })

    expect(onNodeSelect).toHaveBeenCalledTimes(1)
    expect(onNodeActivate).toHaveBeenCalledTimes(1)
    expect(onNodeActivate).toHaveBeenCalledWith('edit-node')
  })
})
