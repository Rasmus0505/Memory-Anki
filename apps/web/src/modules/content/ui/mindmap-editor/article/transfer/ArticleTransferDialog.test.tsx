import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArticleTransferDialog } from './ArticleTransferDialog'
import type { ArticleTransferController } from './useArticleTransfer'
vi.mock('@/shared/components/ui/dialog', () => ({ Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>, DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p> }))
function controller(): ArticleTransferController {
  return { open: true, busy: false, input: { document: { schemaVersion: 1, root: { data: { uid: 'a', text: 'Imported' } } }, manifest: { sourceOwner: 'palace:1', baseRevision: 'r1' } }, warnings: [{ code: 'plain-markdown-lossy', message: '图片不会随纯 Markdown 打包' }], fileName: 'article.zip', error: null, notice: null,
    comparison: { added: ['a'], removed: ['b'], changed: [], sourceOwnerMatches: true, revisionMatches: true, canUpdate: true, hasQuiz: true, assetCount: 1 }, selectedUid: 'parent', disabled: false,
    setOpen: vi.fn(), loadFile: vi.fn(), apply: vi.fn(), exportFile: vi.fn() }
}
describe('article transfer dialog', () => {
  it('shows provenance warnings and requires explicit replace/update confirmation', () => {
    const transfer = controller()
    render(<ArticleTransferDialog transfer={transfer} />)
    expect(screen.getByText('来源：palace:1')).toBeTruthy()
    expect(screen.getByText('图片不会随纯 Markdown 打包')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('导入方式'), { target: { value: 'replace' } })
    expect(screen.getByRole('button', { name: '确认导入' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    expect(transfer.apply).toHaveBeenCalledWith({ mode: 'replace', parentUid: 'parent', confirmReplace: true })
    fireEvent.change(screen.getByLabelText('导入方式'), { target: { value: 'update' } })
    expect(screen.getByRole('button', { name: '确认导入' })).toHaveProperty('disabled', true)
  })
  it('disables update for mismatched origin and all actions for conflicts', () => {
    const transfer = controller()
    transfer.disabled = true
    transfer.comparison!.canUpdate = false
    render(<ArticleTransferDialog transfer={transfer} />)
    expect(screen.getByRole('option', { name: /更新原宫殿/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '导出完整文章包 ZIP' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '确认导入' })).toHaveProperty('disabled', true)
  })
})
