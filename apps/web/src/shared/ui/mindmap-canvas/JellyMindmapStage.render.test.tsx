import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { JellyMindmapStage } from './JellyMindmapStage'
import type { GraphData } from './adapter'

function graph(options: { leafRevealed?: boolean[] } = {}): GraphData {
  const revealed = options.leafRevealed ?? [false, false]
  return {
    nodes: [
      { id: 'root', type: 'peg', label: '宫殿', originalId: 1, parentId: null, metadata: { depth: 0, text: '宫殿' } },
      { id: 'parent', type: 'peg', label: '第一章', originalId: 2, parentId: 'root', metadata: { depth: 1, text: '第一章' } },
      ...revealed.map((isRevealed, index) => ({
        id: `leaf-${index}`,
        type: 'peg' as const,
        label: `答案 ${index}`,
        originalId: index + 3,
        parentId: 'parent',
        metadata: { depth: 2, text: `答案 ${index}`, visual: { revealed: isRevealed } },
      })),
    ],
    edges: [
      { id: 'root-parent', source: 'root', target: 'parent', type: 'parent-child' },
      ...revealed.map((_, index) => ({ id: `parent-leaf-${index}`, source: 'parent', target: `leaf-${index}`, type: 'parent-child' as const })),
    ],
  }
}

function nodeByUid(container: HTMLElement, uid: string) {
  return container.querySelector<HTMLElement>(`[data-jelly-node="${uid}"]`)
}

describe('JellyMindmapStage rendering contract', () => {
  it('renders only leaf cards as flippers, keeping root and parent static', () => {
    const { container } = render(
      <JellyMindmapStage graphData={graph()} selectedNodeId={null} readonly />,
    )
    // Leaves own the 3D flipper; the root and parent never do.
    expect(nodeByUid(container, 'leaf-0')!.querySelector('.jelly-stage-flipper')).toBeTruthy()
    expect(nodeByUid(container, 'leaf-1')!.querySelector('.jelly-stage-flipper')).toBeTruthy()
    expect(nodeByUid(container, 'root')!.querySelector('.jelly-stage-flipper')).toBeNull()
    expect(nodeByUid(container, 'parent')!.querySelector('.jelly-stage-flipper')).toBeNull()
  })

  it('gives each leaf two real faces and flips the revealed one', () => {
    const { container } = render(
      <JellyMindmapStage graphData={graph({ leafRevealed: [true, false] })} selectedNodeId={null} readonly />,
    )
    const flipper = nodeByUid(container, 'leaf-0')!.querySelector('.jelly-stage-flipper')!
    expect(flipper.getAttribute('data-flipped')).toBe('true')
    // A true double-sided card: both front and back faces exist in one flipper.
    expect(flipper.querySelectorAll('.jelly-stage-face')).toHaveLength(2)
    expect(flipper.querySelector('.jelly-stage-back')!.textContent).toContain('答案 0')

    expect(nodeByUid(container, 'leaf-1')!.querySelector('.jelly-stage-flipper')!.getAttribute('data-flipped')).toBe('false')
  })

  it('pins the leaf shell to the exact 270px layout width', () => {
    const { container } = render(
      <JellyMindmapStage graphData={graph()} selectedNodeId={null} readonly />,
    )
    expect(nodeByUid(container, 'leaf-0')!.style.width).toBe('270px')
    expect(nodeByUid(container, 'parent')!.style.width).toBe('260px')
    expect(nodeByUid(container, 'root')!.style.width).toBe('250px')
  })

  it('draws cubic Bézier links instead of stepped edges', () => {
    const { container } = render(
      <JellyMindmapStage graphData={graph()} selectedNodeId={null} readonly />,
    )
    const paths = Array.from(container.querySelectorAll('.jelly-stage-link-line'))
    expect(paths.length).toBe(3)
    for (const path of paths) {
      expect(path.getAttribute('d')).toMatch(/^M [\d.-]+ [\d.-]+ C /)
    }
  })

  it('projects parent progress and stamps MASTERED when every child is open', () => {
    const open = render(
      <JellyMindmapStage graphData={graph({ leafRevealed: [true, false] })} selectedNodeId={null} readonly />,
    )
    expect(nodeByUid(open.container, 'parent')!.textContent).toContain('1 / 2')
    expect(open.container.querySelector('.jelly-stage-stamp')).toBeNull()

    const mastered = render(
      <JellyMindmapStage graphData={graph({ leafRevealed: [true, true] })} selectedNodeId={null} readonly />,
    )
    const stamp = nodeByUid(mastered.container, 'parent')!.querySelector('.jelly-stage-stamp')
    expect(stamp?.textContent).toBe('MASTERED')
  })

  it('routes left click to activate and right click to the context action', () => {
    const onNodeActivate = vi.fn()
    const onNodeContextAction = vi.fn()
    const { container } = render(
      <JellyMindmapStage
        graphData={graph()}
        selectedNodeId={null}
        readonly
        onNodeActivate={onNodeActivate}
        onNodeContextAction={onNodeContextAction}
      />,
    )
    const leaf = nodeByUid(container, 'leaf-0')!
    fireEvent.click(leaf)
    expect(onNodeActivate).toHaveBeenCalledWith('leaf-0')
    fireEvent.contextMenu(leaf)
    expect(onNodeContextAction).toHaveBeenCalledWith('leaf-0')
  })

  it('marks itself as the jelly stage so the generic reveal voice stays silent', () => {
    const { container } = render(
      <JellyMindmapStage graphData={graph()} selectedNodeId={null} readonly />,
    )
    expect(container.querySelector('[data-jelly-stage="true"]')).toBeTruthy()
  })
})
