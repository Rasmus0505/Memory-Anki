import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderNodeCard } from '@/shared/ui/mindmap-canvas/nodeCardTestUtils'

describe('NodeCard edit gesture', () => {
  it('enters edit when the second press misses the yellow text but stays on the card', () => {
    const onStartEdit = vi.fn()
    const highlighted =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">细胞膜与细胞质</span></div>'
    const { container } = renderNodeCard({
      label: '细胞膜与细胞质',
      onStartEdit,
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        text: highlighted,
        richText: true,
      },
    })
    const shell = container.querySelector('[data-mindmap-node-id]') as HTMLElement
    shell.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 200,
      bottom: 90,
      width: 190,
      height: 70,
      toJSON: () => ({}),
    })
    const emphasis = document.querySelector('[data-emphasis="highlight"]') as HTMLElement
    const press = (target: EventTarget, clientX: number, clientY: number) => {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true })
      Object.assign(event, { pointerType: 'mouse', button: 0, clientX, clientY, detail: 1 })
      target.dispatchEvent(event)
    }
    act(() => {
      press(emphasis, 40, 40)
    })
    expect(onStartEdit).not.toHaveBeenCalled()

    act(() => {
      press(document.body, 48, 46)
    })

    expect(onStartEdit).toHaveBeenCalledWith('peg-1')
    expect(screen.getByRole('textbox', { name: '编辑节点文本' })).toBeTruthy()
  })

  it('keeps yellow emphasis and puts the caret at the double-clicked character', () => {
    const highlighted =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">细胞膜与细胞质</span></div>'
    renderNodeCard({
      label: '细胞膜与细胞质',
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        text: highlighted,
        richText: true,
      },
    })
    const emphasis = document.querySelector('[data-emphasis="highlight"]') as HTMLElement
    const text = emphasis.firstChild as Text
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    doc.caretRangeFromPoint = () => {
      const range = document.createRange()
      range.setStart(text, 2)
      range.collapse(true)
      return range
    }

    fireEvent.doubleClick(emphasis, { clientX: 36, clientY: 18 })

    const editor = screen.getByRole('textbox', { name: '编辑节点文本' })
    expect(editor.innerHTML).toContain('data-emphasis="highlight"')
    expect(editor.textContent).toContain('细胞膜与细胞质')
    const selection = window.getSelection()
    expect(selection?.isCollapsed).toBe(true)
    expect(selection?.anchorOffset).toBe(2)
  })

  it('does not enter edit from the fold control or the corner badge', () => {
    const onStartEdit = vi.fn()
    const onExpandSubtree = vi.fn()
    const onCountBadgeClick = vi.fn()
    renderNodeCard({
      label: '分支',
      onStartEdit,
      onExpandSubtree,
      onToggleCollapse: vi.fn(),
      onCountBadgeClick,
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        childCount: 2,
        collapsed: true,
        visual: { countBadge: { text: '3', title: '3 道题' } },
      },
    })

    const toggle = screen.getByRole('button', { name: '展开分支' })
    fireEvent.pointerDown(toggle, { pointerType: 'mouse', button: 0, detail: 1 })
    fireEvent.pointerDown(toggle, { pointerType: 'mouse', button: 0, detail: 2 })
    fireEvent.doubleClick(toggle)
    expect(onStartEdit).not.toHaveBeenCalled()
    expect(onExpandSubtree).toHaveBeenCalledWith('peg-1')

    const badge = screen.getByRole('button', { name: '3 道题' })
    fireEvent.pointerDown(badge, { pointerType: 'mouse', button: 0, detail: 1 })
    fireEvent.pointerDown(badge, { pointerType: 'mouse', button: 0, detail: 2 })
    expect(onStartEdit).not.toHaveBeenCalled()
  })

  it('double-clicks an editable english card into edit without looking the word up', () => {
    vi.useFakeTimers()
    try {
      const onStartEdit = vi.fn()
      const onEnglishWordClick = vi.fn()
      renderNodeCard({
        label: 'powerhouse',
        onStartEdit,
        englishInteractionActive: true,
        onEnglishWordClick,
        metadata: { depth: 2, layoutRole: 'leaf' },
      })
      const word = document.querySelector('[data-reading-word="true"]') as HTMLElement
      fireEvent.pointerDown(word, { pointerType: 'mouse', button: 0, detail: 1 })
      fireEvent.click(word, { detail: 1 })
      fireEvent.pointerDown(word, { pointerType: 'mouse', button: 0, detail: 1 })
      act(() => {
        vi.advanceTimersByTime(600)
      })
      expect(onStartEdit).toHaveBeenCalledWith('peg-1')
      expect(onEnglishWordClick).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
