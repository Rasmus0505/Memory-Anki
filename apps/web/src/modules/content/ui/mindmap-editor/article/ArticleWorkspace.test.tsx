import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArticleWorkspace, type ArticleWorkspaceProps } from './ArticleWorkspace'

vi.mock('./ArticleRichEditor', () => ({ ArticleRichEditor: ({ label }: { label: string }) => <div aria-label={label} /> }))
const document = { root: { data: { uid: 'root', text: '细胞' }, children: [{ data: { uid: 'a', text: '细胞膜', note: '说明', memoryAnkiId: 42 }, children: [{ data: { uid: 'b', text: '流动性' }, children: [] }] }] } }
function props(overrides: Partial<ArticleWorkspaceProps> = {}): ArticleWorkspaceProps {
  return { document, canEdit: true, scopeBranchUid: null, selectedUid: 'a', toolbar: null, canUndo: true, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn(), getDocument: () => document, onCommit: vi.fn(), onSelect: vi.fn(), onLocate: vi.fn(), onDelete: vi.fn(), buildActions: () => [], ...overrides }
}
describe('article workspace', () => {
  it('keeps fullscreen exit available in reading mode and delegates to its host', () => {
    const onToggleFullscreen = vi.fn()
    const input = props({ fullscreen: true, onToggleFullscreen })
    const { rerender } = render(<ArticleWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '退出全屏' }))
    expect(onToggleFullscreen).toHaveBeenCalledOnce()
    expect(input.onCommit).not.toHaveBeenCalled()
    rerender(<ArticleWorkspace {...input} fullscreen={false} />)
    expect(screen.getByRole('button', { name: '进入全屏' }).title).toBe('进入全屏')
  })
  it('starts in reading mode and makes edits only after explicit entry', () => {
    const input = props()
    render(<ArticleWorkspace {...input} />)
    expect(screen.queryByRole('textbox', { name: '知识点标题' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '编辑文章' }))
    const title = screen.getAllByRole('textbox', { name: '知识点标题' })[1]!
    title.textContent = '新的细胞膜'
    fireEvent.blur(title)
    expect(input.onCommit).toHaveBeenCalledWith(expect.objectContaining({ root: expect.objectContaining({ children: [expect.objectContaining({ data: expect.objectContaining({ uid: 'a', text: '新的细胞膜', memoryAnkiId: 42 }) })] }) }))
  })
  it('routes deletion through the existing guarded document action', () => {
    const input = props()
    render(<ArticleWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑文章' }))
    fireEvent.click(screen.getByRole('button', { name: '删除章节' }))
    expect(input.onDelete).toHaveBeenCalledWith('a')
    expect(input.onCommit).not.toHaveBeenCalled()
  })
  it('does not allow structural deletion of the active branch root', () => {
    render(<ArticleWorkspace {...props({ scopeBranchUid: 'a' })} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑文章' }))
    expect((screen.getByRole('button', { name: '删除章节' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('keeps every level visible and marks hierarchy without folding', () => {
    render(<ArticleWorkspace {...props()} />)
    expect(screen.queryByRole('button', { name: '折叠章节' })).toBeNull()
    expect(screen.queryByRole('button', { name: '展开章节' })).toBeNull()
    expect(screen.getByRole('heading', { name: '流动性' })).toBeTruthy()
    expect(globalThis.document.querySelector('[data-article-uid="a"]')?.getAttribute('data-depth')).toBe('1')
    expect(globalThis.document.querySelector('[data-article-uid="b"]')?.getAttribute('data-depth')).toBe('2')
  })
  it('keeps host-concealed bodies hidden and delegates revealing to learning owner', () => {
    const reveal = vi.fn()
    render(<ArticleWorkspace {...props({ revealMap: { a: 'hidden' }, onReveal: reveal })} />)
    expect(screen.queryByText('说明')).toBeNull()
    expect(screen.queryByRole('heading', { name: '细胞膜' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索文章' }), { target: { value: '说明' } })
    expect(screen.getByText('0 处匹配')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回忆这个知识点，然后点击揭晓' }))
    expect(reveal).toHaveBeenCalledWith('a')
    expect(screen.queryByText('说明')).toBeNull()
  })
  it('dispatches shared history and capability actions', () => {
    const quiz = vi.fn()
    const input = props({ buildActions: () => [{ label: '绑定题目', icon: () => null, onClick: quiz }] })
    render(<ArticleWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    fireEvent.click(screen.getByRole('button', { name: '绑定题目' }))
    expect(input.onUndo).toHaveBeenCalledOnce()
    expect(quiz).toHaveBeenCalledOnce()
  })
})
