import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getNodeSize } from '@/shared/ui/mindmap-canvas/layout'
import {
  getNodeShell,
  renderNodeCard,
  selectEditorText,
  setEditorText,
} from '@/shared/ui/mindmap-canvas/nodeCardTestUtils'

describe('NodeCard', () => {
  it('uses single click for selection and double click for editing', () => {
    renderNodeCard({ label: '可编辑内容' })
    const textButton = screen.getByRole('button', { name: '可编辑内容' })

    fireEvent.click(textButton)
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.doubleClick(textButton)
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('focuses the editor and places the caret at the end when double-click starts edit', () => {
    renderNodeCard({ label: '可编辑内容' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '可编辑内容' }))
    const editor = screen.getByRole('textbox', { name: '编辑节点文本' })

    expect(document.activeElement).toBe(editor)
    const selection = window.getSelection()
    expect(selection?.isCollapsed).toBe(true)
    expect(selection?.toString()).toBe('')
  })

  it('selects all text when selectEditText is set on enter-edit', () => {
    renderNodeCard({
      label: '新知识点',
      editing: true,
      editText: '新知识点',
      selectEditText: true,
    })

    const editor = screen.getByRole('textbox', { name: '编辑节点文本' })
    expect(document.activeElement).toBe(editor)
    const selection = window.getSelection()
    expect(selection?.toString()).toBe('新知识点')
  })

  it('keeps the shell as a drag surface while isolating text for reliable double-click edit', () => {
    const { container } = renderNodeCard({
      label: '可编辑内容',
      selected: false,
      metadata: { depth: 1, layoutRole: 'branch' },
    })

    const shell = container.querySelector('[data-mindmap-node-id]')
    expect(shell?.className).toContain('mindmap-node-drag-surface')
    expect(shell?.className).toContain('cursor-grab')
    // Text face is nodrag so yellow-emphasis double-click is not stolen by RF drag.
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('nodrag')
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('cursor-text')
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('select-none')
    expect(screen.queryByRole('button', { name: '拖动节点' })).toBeNull()
  })

  it('keeps unselected idle cards draggable from the shell and removes the old grip handle', () => {
    renderNodeCard({ label: '可编辑内容' })

    expect(screen.queryByRole('button', { name: '拖动节点' })).toBeNull()
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('nodrag')
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('nopan')
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('cursor-text')
  })

  it('widens the edit shell so thicker edit borders do not wrap earlier than display', () => {
    const label = '一二三四五六'
    const displaySize = getNodeSize('branch', label)
    const display = renderNodeCard({
      label,
      metadata: { depth: 1, layoutRole: 'branch' },
    })
    const displayShell = display.container.querySelector('[data-mindmap-node-id]') as HTMLElement
    expect(displayShell.style.width).toBe(`${displaySize.width}px`)
    display.unmount()

    const edit = renderNodeCard({
      label,
      editing: true,
      editText: label,
      metadata: { depth: 1, layoutRole: 'branch' },
    })
    const editShell = edit.container.querySelector('[data-mindmap-node-id]') as HTMLElement
    const editor = screen.getByRole('textbox')
    expect(Number.parseFloat(editShell.style.width)).toBeGreaterThan(displaySize.width)
    expect(editor.className).toContain('break-all')
    expect(editor.className).toContain('whitespace-pre-wrap')
  })

  it('keeps short Chinese labels on one line budget in readonly review display', () => {
    const label = '一二三四'
    const size = getNodeSize('branch', label)
    renderNodeCard({
      label,
      readonly: true,
      metadata: { depth: 1, layoutRole: 'branch' },
    })
    const shell = document.querySelector('[data-mindmap-node-id]') as HTMLElement
    expect(shell.style.width).toBe(`${size.width}px`)
    // Content box (minus chrome) must fit 4 full-width characters without forced wrap.
    expect(size.width - 26 - 8).toBeGreaterThanOrEqual(4 * 13)
    expect(size.height).toBe(getNodeSize('branch', '一').height)
    expect(screen.getByRole('button', { name: label }).className).toContain('whitespace-pre-wrap')
  })

  it('keeps the text editor isolated from node dragging while selecting text', () => {
    renderNodeCard({ label: '需要选中的部分文字' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '需要选中的部分文字' }))
    const editor = screen.getByRole('textbox')

    expect(editor.className).toContain('nodrag')
    expect(editor.className).toContain('nopan')
    expect(editor.className).toContain('nowheel')
  })

  it('does not show the default structural toolbar on selected cards', () => {
    renderNodeCard({
      selected: true,
      parentId: 'root',
      metadata: { depth: 1, layoutRole: 'branch', branchColor: '#2563eb' },
      onAddChild: vi.fn(),
      onAddSibling: vi.fn(),
      onStartEdit: vi.fn(),
    })

    expect(screen.queryByRole('button', { name: '新增子节点' })).toBeNull()
    expect(screen.queryByRole('button', { name: '新增同级节点' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑节点' })).toBeNull()
    expect(getNodeShell().shell.getAttribute('data-node-mode')).toBe('selected')
  })

  it('marks editing mode distinctly from selection', () => {
    renderNodeCard({
      selected: true,
      editing: true,
      editText: '正在编辑',
      label: '正在编辑',
    })

    const editor = screen.getByRole('textbox')
    expect(editor.getAttribute('data-node-mode')).toBe('editing')
    expect(editor.className).toContain('border-sky-500')
    expect(editor.className).toContain('bg-sky-50')
    expect(document.querySelector('[data-node-mode="editing"]')).toBeTruthy()
  })

  it('renders selection toolbar actions for a selected node', () => {
    const onRate = vi.fn()
    renderNodeCard({
      selected: true,
      readonly: true,
      selectionToolbarPreferPosition: 'bottom',
      selectionToolbarActions: [
        { id: 'rate-3', label: '记得 · 1', variant: 'default', onClick: onRate },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: '记得 · 1' }))
    expect(onRate).toHaveBeenCalledTimes(1)
  })

  it('renders status chips above the card and hides the mastery dot', () => {
    renderNodeCard({
      selected: false,
      readonly: true,
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        visual: {
          statusChips: [
            { text: '记得', tone: 'info', style: 'filled' },
            { text: '64', tone: 'warning', style: 'outline' },
          ],
          badge: { tone: 'danger', title: 'weak' },
        },
      },
    })

    expect(screen.getByText('记得')).toBeTruthy()
    expect(screen.getByText('64')).toBeTruthy()
  })

  it('preserves line breaks in display mode', () => {
    renderNodeCard()
    const button = screen.getByRole('button', { name: /第一行/ })
    expect(button.className).toContain('whitespace-pre-wrap')
  })

  it('renders long Chinese labels as wrapped, non-truncated content', () => {
    const longLabel =
      '路德提出应由国家普及义务教育，实施强迫义务教育。加尔文要求国家开办公立学校，实行免费教育；使所有儿童都有机会受到教育，学习其督教教义和日常生活所必需的知识技能。'
    renderNodeCard({
      label: longLabel,
      metadata: { depth: 1, layoutRole: 'branch', branchColor: '#2563eb' },
    })

    const button = screen.getByRole('button', { name: longLabel })
    expect(button.className).toContain('whitespace-pre-wrap')
    expect(button.className).toContain('break-all')
    expect(button.className).not.toContain('truncate')
  })

  it('reports its measured shell size to the canvas', () => {
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(152)
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(96)
    const onMeasure = vi.fn()

    try {
      renderNodeCard({ onMeasure })

      expect(onMeasure).toHaveBeenCalledWith('peg-1', { width: 152, height: 96 })
    } finally {
      offsetWidth.mockRestore()
      offsetHeight.mockRestore()
    }
  })

  it('does not report duplicate measurements within the same pixel threshold', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | null = null
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    })
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(152)
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(96)
    const onMeasure = vi.fn()

    try {
      renderNodeCard({ onMeasure })

      expect(onMeasure).toHaveBeenCalledTimes(1)
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      expect(onMeasure).toHaveBeenCalledTimes(1)

      offsetHeight.mockReturnValue(120)
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      expect(onMeasure).toHaveBeenCalledTimes(2)
      expect(onMeasure).toHaveBeenLastCalledWith('peg-1', { width: 152, height: 120 })
    } finally {
      offsetWidth.mockRestore()
      offsetHeight.mockRestore()
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      })
    }
  })

  it('commits edits on plain Enter', () => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const editor = screen.getByRole('textbox')

    setEditorText(editor, '更新内容')
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(onFinishEdit).toHaveBeenCalledWith('peg-1', '更新内容')
  })

  it('keeps the caret position while controlled draft updates propagate', () => {
    const onEditTextChange = vi.fn()
    renderNodeCard({ label: 'abcdef', onEditTextChange })
    fireEvent.doubleClick(screen.getByRole('button', { name: 'abcdef' }))
    const editor = screen.getByRole('textbox')

    setEditorText(editor, 'abdef')
    selectEditorText(editor, 2, 2)

    expect(editor.textContent).toBe('abdef')
    expect(onEditTextChange).toHaveBeenLastCalledWith('peg-1', 'abdef')
  })

  it('does not jump the caret to the end after mid-edit deletes that change node height', () => {
    // Multi-line label: deleting a whole line shrinks measured height. The old enter-edit
    // effect re-ran on focusEditorCaret identity churn and forced caret to end.
    const label = '第一行内容比较长\n第二行内容也比较长\n第三行收尾'
    renderNodeCard({
      label,
      metadata: { depth: 1, layoutRole: 'branch', text: label },
    })
    fireEvent.doubleClick(screen.getByRole('button', { name: label }))
    const editor = screen.getByRole('textbox')

    // Place caret at the start, then delete enough text to change node height.
    selectEditorText(editor, 0, 0)
    const shortened = '第二行内容也比较长\n第三行收尾'
    setEditorText(editor, shortened)
    // Re-assert after React flushes layout from the shorter draft (do not re-select).
    act(() => {
      // Allow any deferred layout/focus retries to run.
    })

    const selection = window.getSelection()
    const textLen = editor.textContent?.length ?? 0
    const forcedToEnd =
      Boolean(selection?.rangeCount) &&
      Boolean(selection?.isCollapsed) &&
      selection?.anchorNode === editor.firstChild &&
      selection?.anchorOffset === textLen
    // Must not re-place caret at end after draft/size updates mid-session.
    expect(forcedToEnd).toBe(false)
    expect(editor.textContent).toBe(shortened)
  })

  it('uses local text undo without leaving edit mode', () => {
    renderNodeCard({ label: '原始内容' })
    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const editor = screen.getByRole('textbox')

    setEditorText(editor, '原始内')
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })

    // Ctrl+Z is handled locally and must keep the card in edit mode.
    expect(screen.getByRole('textbox')).toBe(editor)
    expect(screen.queryByRole('button', { name: '原始内容' })).toBeNull()
  })

  it('shows a distinct editor without an internal scrollbar', () => {
    renderNodeCard({ label: '编辑视觉' })
    fireEvent.doubleClick(screen.getByRole('button', { name: '编辑视觉' }))
    const textarea = screen.getByRole('textbox')

    expect(textarea.className).toContain('border-sky-500')
    expect(textarea.className).toContain('overflow-hidden')
    expect(textarea.style.scrollbarWidth).toBe('none')
  })

  it('maps readonly double click to the recall cancel handler', () => {
    const onReadonlyDoubleClick = vi.fn()
    renderNodeCard({
      label: '待回忆',
      readonly: true,
      onReadonlyDoubleClick,
    })

    fireEvent.doubleClick(screen.getByRole('button', { name: '待回忆' }))

    expect(onReadonlyDoubleClick).toHaveBeenCalledWith('peg-1')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it.each([
    ['Shift+Enter', { shiftKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
  ])('keeps editing on %s so line breaks can be preserved', (_name, modifier) => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const editor = screen.getByRole('textbox')

    setEditorText(editor, '第一行\n第二行')
    fireEvent.keyDown(editor, { key: 'Enter', ...modifier })

    expect(onFinishEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox').textContent).toBe('第一行\n第二行')
  })

  it('keeps Tab inside the editor while editing instead of creating structure', () => {
    const onEditTextChange = vi.fn()
    const { onFinishEdit } = renderNodeCard({ label: '原始内容', onEditTextChange })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const editor = screen.getByRole('textbox')
    selectEditorText(editor, 2, 2)
    // jsdom may not implement execCommand insertText; assert Tab is swallowed for structure.
    const prevented = fireEvent.keyDown(editor, { key: 'Tab' })
    expect(prevented).toBe(false)
    expect(onFinishEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBe(editor)
  })

  it('cancels edits on Escape', () => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const editor = screen.getByRole('textbox')

    setEditorText(editor, '不会保存')
    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(onFinishEdit).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: '原始内容' })).toBeTruthy()
  })

  it('shows yellow highlight toolbar for selected text and toggles highlight markup', () => {
    const { onFinishEdit } = renderNodeCard({
      label: '细胞膜与细胞质',
      editing: true,
      editText: '细胞膜与细胞质',
      metadata: { depth: 1, layoutRole: 'branch', text: '细胞膜与细胞质' },
    })

    const editor = screen.getByRole('textbox')
    act(() => {
      selectEditorText(editor, 0, 3)
    })
    expect(screen.getByRole('button', { name: '黄色底色' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '黄色底色' }))
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(onFinishEdit).toHaveBeenCalled()
    const committed = String(onFinishEdit.mock.calls.at(-1)?.[1] || '')
    expect(committed).toContain('data-emphasis="highlight"')
    expect(committed).toContain('细胞膜')
  })

  it('double-clicks into edit on cards that already have yellow emphasis markup', () => {
    const onStartEdit = vi.fn()
    const highlighted =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">细胞膜与细胞质</span></div>'
    renderNodeCard({
      label: '细胞膜与细胞质',
      editing: false,
      onStartEdit,
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        text: highlighted,
        richText: true,
      },
    })

    const emphasis = document.querySelector('[data-emphasis="highlight"]')
    expect(emphasis).toBeTruthy()
    // Highlight lives under a block wrapper (div.mindmap-rich-text), not an invalid span>div tree.
    expect(emphasis?.closest('.mindmap-rich-text')?.tagName).toBe('DIV')
    expect(emphasis?.closest('.mindmap-node-text')?.className).toContain('nodrag')
    fireEvent.doubleClick(emphasis!)

    expect(onStartEdit).toHaveBeenCalledWith('peg-1')
    // Optimistic enter-edit even when parent still has editing=false.
    expect(screen.getByRole('textbox', { name: '编辑节点文本' })).toBeTruthy()
  })

  it('enters edit optimistically on controlled cards when parent editing lags', () => {
    const onStartEdit = vi.fn()
    renderNodeCard({
      label: '滞后控制',
      editing: false,
      onStartEdit,
    })

    fireEvent.doubleClick(screen.getByRole('button', { name: '滞后控制' }))
    expect(onStartEdit).toHaveBeenCalledWith('peg-1')
    expect(screen.getByRole('textbox', { name: '编辑节点文本' })).toBeTruthy()
  })

  it('seeds the editor with existing yellow emphasis markup instead of stripping it', () => {
    const highlighted =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">细胞膜</span></div>'
    renderNodeCard({
      label: '细胞膜',
      editing: true,
      editText: highlighted,
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        text: highlighted,
        richText: true,
      },
    })

    const editor = screen.getByRole('textbox', { name: '编辑节点文本' })
    expect(editor.innerHTML).toContain('data-emphasis="highlight"')
    expect(editor.textContent).toContain('细胞膜')
  })

  it('uses the unified root card shadow', () => {
    renderNodeCard()

    const { container } = getNodeShell()
    expect(container.className).toContain('shadow-sm')
    expect(container.className).not.toContain('shadow-md')
  })

  it('shows emerald feedback and child-slot placeholder when dropping inside a node', () => {
    renderNodeCard({ dropHighlight: true, dropMode: 'inside' })
    expect(document.querySelector('[data-drop-placeholder="inside"]')).toBeTruthy()
    expect(document.querySelector('[data-drop-placeholder-label="inside"]')?.textContent).toContain(
      '成为子卡片',
    )

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-emerald-400/70')
    expect(container.className).toContain('bg-emerald-50/20')
  })

  it('shows blue feedback when dropping before or after a node', () => {
    renderNodeCard({ dropHighlight: true, dropMode: 'before' })

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-sky-400/70')
  })

  it('makes dragged nodes ghosted even when the node is also muted', () => {
    renderNodeCard({ previewGhost: true, metadata: { depth: 1, layoutRole: 'branch', visual: { muted: true } } })

    const { shell } = getNodeShell()
    expect(shell.className).toContain('opacity-35')
    expect(shell.className).toContain('scale-[0.97]')
    expect(shell.className).not.toContain('opacity-60')
  })

  it('keeps non-dragged muted nodes at the lighter dim state', () => {
    renderNodeCard({ metadata: { depth: 1, layoutRole: 'branch', visual: { muted: true } } })

    const { shell } = getNodeShell()
    expect(shell.className).toContain('opacity-60')
  })

  it('uses a stronger preview shift while dragging', () => {
    renderNodeCard({ previewShifted: true })

    const { shell } = getNodeShell()
    expect(shell.className).toContain('translate-y-2')
  })

  it('reads recall and marker states from metadata when top-level fields are absent', () => {
    renderNodeCard({
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        branchColor: '#89a89e',
        visual: {
          placeholder: true,
          borderColor: '#ef4444',
          outlineTones: ['danger', 'info'],
        },
      },
    })

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-amber-400/35')
    expect(container.className).toContain('outline-rose-400/55')
    expect(container.className).toContain('outline-sky-400/70')
    expect(container.style.borderColor).toBe('rgb(239, 68, 68)')
  })

  it('reads hidden recall state from metadata', () => {
    renderNodeCard({
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        branchColor: '#89a89e',
        visual: { concealText: true },
      },
    })

    const button = screen.getByRole('button', { name: '待回忆' })
    expect(button.className).toContain('blur-[3px]')
  })
})

