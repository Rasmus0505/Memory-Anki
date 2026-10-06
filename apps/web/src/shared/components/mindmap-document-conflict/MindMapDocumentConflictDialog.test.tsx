import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MindMapEditorConflict } from '@/shared/persistence/mindmapEditorDraftStore'
import { MindMapDocumentConflictDialog } from './MindMapDocumentConflictDialog'

const snapshot = (text: string) => ({ editor_doc: { root: { data: { uid: 'root', text } } }, editor_config: {}, editor_local_config: {}, lang: 'zh' })
const conflict: MindMapEditorConflict = { ownerId: 7, operationId: 3, localSnapshot: snapshot('Local title'),
  remoteSnapshot: snapshot('Remote title'), baseEditorFingerprint: 'base', remoteEditorFingerprint: 'remote', reason: 'save-conflict' }

describe('document conflict recovery dialog', () => {
  it('shows both versions and recovery JSON and binds remote choice to the operation', async () => {
    const resolveConflict = vi.fn().mockResolvedValue(true)
    render(<MindMapDocumentConflictDialog pendingConflict={conflict} resolveConflict={resolveConflict} />)
    expect(screen.getByRole('region', { name: '本地版本' }).textContent).toContain('Local title')
    expect(screen.getByRole('region', { name: '远端版本' }).textContent).toContain('Remote title')
    const recovery = screen.getByRole('link', { name: /下载双方/ })
    const data = JSON.parse(decodeURIComponent(recovery.getAttribute('href')!.split(',')[1]))
    expect(data.localSnapshot).toEqual(conflict.localSnapshot)
    expect(data.remoteSnapshot).toEqual(conflict.remoteSnapshot)
    expect((screen.getByRole('button', { name: '合并独立节点编辑' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '选用远端版本' }))
    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith({ ownerId: 7, operationId: 3, choice: 'remote' }))
  })
  it('retains recovery and provides an accessible archive failure with retry', async () => {
    const resolveConflict = vi.fn().mockRejectedValue(new Error('磁盘满'))
    render(<MindMapDocumentConflictDialog pendingConflict={conflict} resolveConflict={resolveConflict} />)
    fireEvent.click(screen.getByRole('button', { name: '选用本地版本' }))
    expect((await screen.findByRole('alert')).textContent).toContain('磁盘满')
    expect(screen.getByRole('link', { name: /下载双方/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '选用本地版本' }))
    await waitFor(() => expect(resolveConflict).toHaveBeenCalledTimes(2))
  })
  it('offers explicit manual merge only with a real baseline', async () => {
    const resolveConflict = vi.fn().mockResolvedValue(true)
    const pending = { ...conflict, baselineSnapshot: conflict.remoteSnapshot }
    render(<MindMapDocumentConflictDialog pendingConflict={pending} resolveConflict={resolveConflict} />)
    fireEvent.click(screen.getByRole('button', { name: '合并独立节点编辑' }))
    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 7, operationId: 3,
      choice: 'manual', snapshot: expect.objectContaining({ editor_doc: conflict.localSnapshot.editor_doc }) })))
  })
  it('can postpone and reopen without silently resolving', () => {
    const resolveConflict = vi.fn()
    render(<MindMapDocumentConflictDialog pendingConflict={conflict} resolveConflict={resolveConflict} />)
    fireEvent.click(screen.getByRole('button', { name: '稍后处理' }))
    expect(screen.getByRole('alert').textContent).toContain('自动保存已暂停')
    fireEvent.click(screen.getByRole('button', { name: '查看并解决冲突' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(resolveConflict).not.toHaveBeenCalled()
  })
  it('ignores late errors after switching owners', async () => {
    let reject!: (error: Error) => void
    const resolveConflict = vi.fn(() => new Promise<boolean>((_, no) => { reject = no }))
    const view = render(<MindMapDocumentConflictDialog pendingConflict={conflict} resolveConflict={resolveConflict} />)
    fireEvent.click(screen.getByRole('button', { name: '选用本地版本' }))
    view.rerender(<MindMapDocumentConflictDialog pendingConflict={{ ...conflict, ownerId: 8 }} resolveConflict={resolveConflict} />)
    reject(new Error('old failure'))
    await waitFor(() => expect((screen.getByRole('button', { name: '选用本地版本' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
