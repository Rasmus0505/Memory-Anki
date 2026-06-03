import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BilinkSearchPopover } from './BilinkSearchPopover'
import type { BilinkSearchResult } from '@/shared/api/contracts'

const mixedResults: BilinkSearchResult[] = [
  {
    type: 'node',
    palace_id: 2,
    palace_title: '<div>紫禁城</div>',
    node_uid: 'node-1',
    node_text: '<div>真正命中内容<br>第二行&nbsp;</div>',
    node_path: ['根节点', '路径节点', 'L1'],
  },
  {
    type: 'node',
    palace_id: 2,
    palace_title: '<div>紫禁城</div>',
    node_uid: 'node-2',
    node_text: '<p>另一条&nbsp;结果</p>',
    node_path: ['根节点', '另一条路径'],
  },
  {
    type: 'palace',
    palace_id: 1,
    palace_title: '<div>故宫&nbsp;总览</div>',
    node_uid: null,
    node_text: null,
    node_path: null,
  },
]

describe('BilinkSearchPopover', () => {
  it('renders palace groups with cleaned hit text and no path tree chrome', () => {
    render(
      <BilinkSearchPopover
        open
        position={null}
        mode="toolbar"
        query="命中"
        loading={false}
        error=""
        results={mixedResults}
        onQueryChange={vi.fn()}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
      />,
    )

    expect(screen.getByText('故宫 总览')).toBeTruthy()
    expect(screen.getByText('宫殿标题匹配')).toBeTruthy()
    expect(screen.getByText('紫禁城')).toBeTruthy()
    expect(screen.getByText('2 条内容命中')).toBeTruthy()
    expect(screen.getByText(/真正命中内容/)).toBeTruthy()
    expect(screen.getByText(/第二行/)).toBeTruthy()
    expect(screen.getByText('另一条 结果')).toBeTruthy()

    expect(screen.queryByText('路径')).toBeNull()
    expect(screen.queryByText('路径节点')).toBeNull()
    expect(screen.queryByText('L1')).toBeNull()
    expect(screen.queryByText(/<div>|<p>/)).toBeNull()
  })

  it('keeps palace-level actions available when only the palace title matches', () => {
    const onSelect = vi.fn()
    const onPreview = vi.fn()

    render(
      <BilinkSearchPopover
        open
        position={null}
        mode="toolbar"
        query="故宫"
        loading={false}
        error=""
        results={mixedResults.filter((result) => result.type === 'palace')}
        onQueryChange={vi.fn()}
        onClose={vi.fn()}
        onSelect={onSelect}
        onPreview={onPreview}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    fireEvent.click(screen.getByRole('button', { name: '查看宫殿' }))

    expect(onPreview).toHaveBeenCalledWith(mixedResults[2])
    expect(onSelect).toHaveBeenCalledWith(mixedResults[2])
    expect(screen.queryByText(/条内容命中/)).toBeNull()
  })
})
