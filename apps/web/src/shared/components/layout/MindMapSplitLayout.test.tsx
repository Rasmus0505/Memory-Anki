import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { MindMapSplitLayout } from './MindMapSplitLayout'

function Harness({
  side = 'start' as const,
  hidden = false,
  railMode,
}: {
  side?: 'start' | 'end'
  hidden?: boolean
  railMode?: 'always' | 'below-lg' | 'never'
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <MindMapSplitLayout
      side={side}
      hidden={hidden}
      railMode={railMode}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      sidePanel={<div>绑定面板</div>}
    >
      <div>脑图画布</div>
    </MindMapSplitLayout>
  )
}

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

  it('hides the rail in immersive mode so only the mind map remains', () => {
    render(<Harness hidden />)

    expect(screen.getByText('脑图画布')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '收起侧栏' })).toBeNull()
    expect(screen.queryByText('绑定面板')).toBeNull()
  })
})
