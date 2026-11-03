import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MindMapSplitLayout } from './MindMapSplitLayout'

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
  it('keeps the mind map beside the side panel and can collapse the panel to a rail', () => {
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

  it('can keep the rail for narrow viewports only when the host owns the toggle', () => {
    render(<Harness railMode="below-lg" />)

    const toggle = screen.getByRole('button', { name: '收起侧栏' })
    expect(toggle.parentElement?.className).toContain('lg:hidden')
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
