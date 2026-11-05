import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MindMapSplitLayout, SplitPanelToggle } from './MindMapSplitLayout'

function Harness({
  side = 'start' as const,
  hidden = false,
  railMode,
  resizable = false,
}: {
  side?: 'start' | 'end'
  hidden?: boolean
  railMode?: 'always' | 'below-lg' | 'never'
  resizable?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <MindMapSplitLayout
      side={side}
      hidden={hidden}
      railMode={railMode}
      resizable={resizable}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      sidePanel={<div>绑定面板</div>}
    >
      <div>脑图画布</div>
    </MindMapSplitLayout>
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('MindMapSplitLayout', () => {
  it('keeps the mind map beside the side panel and can collapse the panel', () => {
    render(<Harness />)

    expect(screen.getByText('绑定面板')).toBeTruthy()
    expect(screen.getByText('脑图画布')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))

    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeTruthy()
    expect(screen.getByText('脑图画布')).toBeTruthy()
  })

  it('uses right-side labels when the chrome sits after the mind map', () => {
    render(<Harness side="end" />)

    fireEvent.click(screen.getByRole('button', { name: '收起右侧栏' }))
    expect(screen.getByRole('button', { name: '展开右侧栏' })).toBeTruthy()
  })

  it('reserves no column for the toggle: it sits inside the panel, and a collapsed panel leaves only an edge tab', () => {
    const { container } = render(<Harness />)
    const layout = container.firstElementChild as HTMLElement
    // aside + canvas only; the phone backdrop (md:hidden) and the absolute tab take no column.
    const columns = Array.from(layout.children).filter((child) => !child.classList.contains('md:hidden') && !child.classList.contains('absolute'))
    expect(columns.map((child) => child.tagName)).toEqual(['ASIDE', 'SECTION'])
    expect(screen.getByRole('button', { name: '收起侧栏' }).closest('aside')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
    const tab = screen.getByRole('button', { name: '展开侧栏' })
    expect(tab.closest('aside')).toBeNull()
    expect(tab.className).toContain('absolute')
  })

  it('puts the toggle in the panel title row when the panel renders SplitPanelToggle', () => {
    function WithHeader() {
      const [collapsed, setCollapsed] = useState(false)
      return (
        <MindMapSplitLayout
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          sidePanel={<div data-testid="title-row"><span>目录</span><SplitPanelToggle /></div>}
        >
          <div>脑图画布</div>
        </MindMapSplitLayout>
      )
    }
    render(<WithHeader />)
    const toggles = screen.getAllByRole('button', { name: '收起侧栏' })
    expect(toggles).toHaveLength(1)
    expect(screen.getByTestId('title-row').contains(toggles[0])).toBe(true)
  })

  it('draws no toggle at all when the host owns it', () => {
    render(<Harness railMode="never" />)
    expect(screen.queryByRole('button', { name: '收起侧栏' })).toBeNull()
  })

  it('resizes the side panel by dragging the divider and remembers the width', () => {
    render(<Harness resizable />)

    const handle = screen.getByRole('separator', { name: '调整侧栏宽度' })
    const aside = screen.getByText('绑定面板').closest('aside') as HTMLElement
    expect(aside.style.width).toBe('min(280px, 85vw)')

    fireEvent.mouseDown(handle, { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 360 })
    expect(aside.style.width).toBe('min(340px, 85vw)')

    fireEvent.mouseUp(window)
    expect(JSON.parse(localStorage.getItem('memory_anki.mind_map_split_side_width') ?? 'null')).toBe(340)
  })

  it('shrinks from the right when the panel sits after the canvas', () => {
    render(<Harness side="end" resizable />)

    const handle = screen.getByRole('separator', { name: '调整侧栏宽度' })
    const aside = screen.getByText('绑定面板').closest('aside') as HTMLElement

    fireEvent.mouseDown(handle, { button: 0, clientX: 600 })
    fireEvent.mouseMove(window, { clientX: 560 })
    expect(aside.style.width).toBe('min(320px, 85vw)')
  })

  it('hides the divider when the panel is folded or resizing is off', () => {
    const { rerender } = render(<Harness />)
    expect(screen.queryByRole('separator', { name: '调整侧栏宽度' })).toBeNull()

    rerender(<Harness resizable />)
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
    expect(screen.queryByRole('separator', { name: '调整侧栏宽度' })).toBeNull()
  })

  it('hides the rail in immersive mode so only the mind map remains', () => {
    render(<Harness hidden />)

    expect(screen.getByText('脑图画布')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '收起侧栏' })).toBeNull()
    expect(screen.queryByText('绑定面板')).toBeNull()
  })
})
