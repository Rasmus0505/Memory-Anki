import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RowContextMenu } from './RowContextMenu'
import { composeMenu, menuItem } from './compose'
import { InlineRenameInput } from '../inline-rename/InlineRenameInput'

describe('RowContextMenu', () => {
  it('opens on right click and runs the chosen item', async () => {
    const onSelect = vi.fn()
    render(
      <RowContextMenu items={[menuItem('打开', undefined, onSelect)]}>
        <button type="button">宫殿一</button>
      </RowContextMenu>,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '宫殿一' }))

    const item = await screen.findByRole('menuitem', { name: '打开' })
    fireEvent.click(item)
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
  })

  it('renders rows without a menu when there is nothing to offer', () => {
    render(
      <RowContextMenu items={null}>
        <button type="button">只读行</button>
      </RowContextMenu>,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '只读行' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('separates sections and drops empty ones', () => {
    const first = menuItem('打开', undefined, () => undefined)
    const second = menuItem('删除', undefined, () => undefined, { danger: true })
    expect(composeMenu([first], [], null, [second])).toEqual([
      first,
      { kind: 'separator' },
      second,
    ])
    expect(composeMenu([], null)).toEqual([])
  })
})

describe('InlineRenameInput', () => {
  it('commits the trimmed value on Enter', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineRenameInput defaultValue="旧名字" onCommit={onCommit} onCancel={onCancel} />,
    )
    const input = screen.getByRole('textbox', { name: '重命名' })
    fireEvent.change(input, { target: { value: '  新名字  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('新名字')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Escape without writing', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineRenameInput defaultValue="旧名字" onCommit={onCommit} onCancel={onCancel} />,
    )
    const input = screen.getByRole('textbox', { name: '重命名' })
    fireEvent.change(input, { target: { value: '新名字' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('treats an unchanged or blank value as a cancel', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineRenameInput defaultValue="旧名字" onCommit={onCommit} onCancel={onCancel} />,
    )
    const input = screen.getByRole('textbox', { name: '重命名' })
    fireEvent.change(input, { target: { value: '旧名字' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
