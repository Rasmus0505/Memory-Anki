import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as segmentApi from '@/modules/content/public'
import { fireEvent, mockPalaceEditorResponse, renderPalaceEditPage, screen, setupPalaceEditPageTestDefaults, waitFor } from '@/pages/create/PalaceEditorPage.test-support'

describe('PalaceEditorPage learning group selection', () => {
  beforeEach(() => setupPalaceEditPageTestDefaults())

  it('selects a clicked subtree and saves it as a learning group', async () => {
    const createSegment = vi.spyOn(segmentApi, 'createPalaceSegmentApi').mockResolvedValue({ item: {} } as never)
    vi.spyOn(segmentApi, 'getPalaceSegmentsApi').mockResolvedValue({ items: [] })
    mockPalaceEditorResponse({ root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [{ data: { text: '子节点', uid: 'child-1' }, children: [{ data: { text: '孙节点', uid: 'grandchild-1' }, children: [] }] }] } })

    renderPalaceEditPage()
    fireEvent.click(await screen.findByRole('button', { name: '学习组' }))
    await screen.findByLabelText('学习组目标')
    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    expect(await screen.findByText('selected-segment-nodes-2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    fireEvent.change(await screen.findByPlaceholderText('例如：第二学习组'), { target: { value: '重点组' } })
    fireEvent.click(screen.getByRole('button', { name: '保存学习组' }))

    await waitFor(() => expect(createSegment).toHaveBeenCalledWith(101, expect.objectContaining({ name: '重点组', node_uids: ['child-1', 'grandchild-1'] })))
  })

  it('removes the whole subtree when the branch is clicked again', async () => {
    mockPalaceEditorResponse({ root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [{ data: { text: '子节点', uid: 'child-1' }, children: [{ data: { text: '孙节点', uid: 'grandchild-1' }, children: [] }] }] } })

    renderPalaceEditPage()
    fireEvent.click(await screen.findByRole('button', { name: '学习组' }))
    await screen.findByLabelText('学习组目标')
    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    expect(await screen.findByText('selected-segment-nodes-2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    expect(await screen.findByText('selected-segment-nodes-0')).toBeTruthy()
  })
})

