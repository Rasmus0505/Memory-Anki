import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/react'
import { useState } from 'react'
import { ArticleRichEditor } from './ArticleRichEditor'
import { createArticleBody, validateArticleBody } from '@/modules/content/domain/mindmap-document-entity/model/articleDocument'

// jsdom lacks Range geometry, used by real ProseMirror scroll-to-selection.
const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const originalRangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, 0, 0, 0) })
})
afterAll(() => {
  if (originalRangeRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeRects)
  else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  if (originalRangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeBounds)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})
afterEach(cleanup)

function editorInstance(): Editor {
  return (screen.getByRole('textbox', { name: 'Test body' }) as HTMLElement & { editor: Editor }).editor
}
function Harness({ onChange = () => {}, onUndo = () => {} }: { onChange?: (json: JSONContent) => void; onUndo?: () => void }) {
  const [body, setBody] = useState<JSONContent>(createArticleBody('Seed'))
  return <div onKeyDown={(event) => { if (event.ctrlKey && event.key === 'z') { event.preventDefault(); onUndo() } }}>
    <ArticleRichEditor label="Test body" editable content={body} onChange={(json) => { onChange(json); setBody(json) }} />
  </div>
}

describe('actual Tiptap article editor', () => {
  it('uploads a local file and inserts returned attachment URL', async () => {
    const upload = vi.fn().mockResolvedValue({ src: '/api/attachments/photo.png', alt: 'Uploaded' })
    render(<ArticleRichEditor label="Test body" editable content={createArticleBody('Body')} onChange={() => {}} uploadImage={upload} uploadOwnerKey="palace:1:node:a" />)
    await screen.findByRole('textbox', { name: 'Test body' })
    fireEvent.click(screen.getByRole('button', { name: '图片' }))
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('上传本地图片'), { target: { files: [file] } })
    await waitFor(() => expect(document.querySelector('.tiptap img')?.getAttribute('src')).toBe('/api/attachments/photo.png'))
    expect(upload).toHaveBeenCalledWith(file)
    expect(validateArticleBody(editorInstance().getJSON())).not.toBeNull()
  })

  it('ignores late upload success after owner/block changes', async () => {
    let resolve!: (value: { src: string }) => void
    const upload = vi.fn(() => new Promise<{ src: string }>((done) => { resolve = done }))
    const changes = vi.fn()
    const { rerender } = render(<ArticleRichEditor label="Test body" editable content={createArticleBody('A')} onChange={changes} uploadImage={upload} uploadOwnerKey="palace:1:a" />)
    const textbox = await screen.findByRole('textbox', { name: 'Test body' })
    fireEvent.paste(textbox, { clipboardData: { getData: () => '', files: [new File(['bytes'], 'a.png', { type: 'image/png' })] } })
    expect(upload).toHaveBeenCalledOnce()
    rerender(<ArticleRichEditor label="Test body" editable content={createArticleBody('B')} onChange={changes} uploadImage={upload} uploadOwnerKey="palace:2:b" />)
    changes.mockClear()
    await act(async () => { resolve({ src: '/old-owner.png' }); await Promise.resolve() })
    expect(document.querySelector('.tiptap img')).toBeNull()
    expect(editorInstance().getText()).toBe('B')
    expect(changes).not.toHaveBeenCalled()
  })

  it('rejects SVG and oversize clipboard files before upload', async () => {
    const upload = vi.fn()
    render(<ArticleRichEditor label="Test body" editable content={createArticleBody('Body')} onChange={() => {}} uploadImage={upload} uploadOwnerKey="palace:1:a" />)
    const textbox = await screen.findByRole('textbox', { name: 'Test body' })
    fireEvent.paste(textbox, { clipboardData: { getData: () => '', files: [new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })] } })
    expect(screen.getByRole('alert').textContent).toContain('不支持 SVG')
    const oversized = new File(['bytes'], 'large.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 })
    fireEvent.paste(textbox, { clipboardData: { getData: () => '', files: [oversized] } })
    expect(upload).not.toHaveBeenCalled()
  })

  it('ignores late rejected upload after unmount', async () => {
    let reject!: (error: Error) => void
    const upload = vi.fn(() => new Promise<{ src: string }>((_resolve, fail) => { reject = fail }))
    const changes = vi.fn()
    const { unmount } = render(<ArticleRichEditor label="Test body" editable content={createArticleBody('Body')} onChange={changes} uploadImage={upload} uploadOwnerKey="palace:1:a" />)
    const textbox = await screen.findByRole('textbox', { name: 'Test body' })
    fireEvent.paste(textbox, { clipboardData: { getData: () => '', files: [new File(['bytes'], 'a.png', { type: 'image/png' })] } })
    unmount()
    changes.mockClear()
    await act(async () => { reject(new Error('Late failure')); await Promise.resolve() })
    expect(changes).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([['#', 'heading'], ['-', 'list'], ['1.', 'list']])('maps standalone %s shortcut without body loss', async (marker, kind) => {
    const structure = vi.fn()
    render(<ArticleRichEditor label="Test body" editable content={createArticleBody(`Keep this\n${marker}`)} onChange={() => {}} onStructure={structure} />)
    const textbox = await screen.findByRole('textbox', { name: 'Test body' })
    const editor = editorInstance()
    act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1) })
    fireEvent.keyDown(textbox, { key: ' ' })
    expect(structure).toHaveBeenCalledWith({ kind, placement: 'sibling' })
    expect(editor.getText()).toContain('Keep this')
    expect(editor.getText()).not.toContain(marker)
  })

  it('maps mobile text input and toolbar actions to structural requests', async () => {
    const structure = vi.fn()
    render(<ArticleRichEditor label="Test body" editable content={createArticleBody('#')} onChange={() => {}} onStructure={structure} />)
    await screen.findByRole('textbox', { name: 'Test body' })
    const editor = editorInstance()
    act(() => {
      editor.commands.setTextSelection(2)
      editor.view.someProp('handleTextInput', (handler) => handler(editor.view, 2, 2, ' ', () => editor.state.tr.insertText(' ', 2)))
    })
    expect(structure).toHaveBeenCalledWith({ kind: 'heading', placement: 'sibling' })
    fireEvent.click(screen.getByRole('button', { name: '子知识点' }))
    expect(structure).toHaveBeenLastCalledWith({ kind: 'heading', placement: 'child' })
    fireEvent.click(screen.getByRole('button', { name: '新知识点' }))
    expect(structure).toHaveBeenLastCalledWith({ kind: 'heading', placement: 'sibling' })
  })

  it('does not consume IME space, existing prose or imported nested lists', async () => {
    const structure = vi.fn()
    const { rerender } = render(<ArticleRichEditor label="Test body" editable content={createArticleBody('#')} onChange={() => {}} onStructure={structure} />)
    const textbox = await screen.findByRole('textbox', { name: 'Test body' })
    act(() => { editorInstance().commands.setTextSelection(2) })
    fireEvent.keyDown(textbox, { key: ' ', isComposing: true, keyCode: 229 })
    expect(structure).not.toHaveBeenCalled()
    expect(editorInstance().getText()).toBe('#')
    rerender(<ArticleRichEditor label="Test body" editable content={createArticleBody('# existing text')} onChange={() => {}} onStructure={structure} />)
    act(() => { editorInstance().commands.setTextSelection(2) })
    fireEvent.keyDown(textbox, { key: ' ' })
    expect(structure).not.toHaveBeenCalled()
    const list = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '-' }] }] }] }] }
    rerender(<ArticleRichEditor label="Test body" editable content={list} onChange={() => {}} onStructure={structure} />)
    act(() => { editorInstance().commands.setTextSelection(4) })
    fireEvent.keyDown(textbox, { key: ' ' })
    expect(structure).not.toHaveBeenCalled()
    expect(JSON.stringify(editorInstance().getJSON())).toContain('bulletList')
  })

  it('publishes real text transactions as valid body JSON and preserves caret on controlled echoes', async () => {
    const changes = vi.fn()
    render(<Harness onChange={changes} />)
    await screen.findByRole('textbox', { name: 'Test body' })
    const editor = editorInstance()
    act(() => { editor.commands.setTextSelection(3); editor.commands.insertContent('中文') })
    await waitFor(() => expect(changes).toHaveBeenCalled())
    expect(validateArticleBody(changes.mock.lastCall?.[0])).not.toBeNull()
    expect(editor.getText()).toBe('Se中文ed')
    expect(editor.state.selection.from).toBe(5)
    expect(editor.state.selection.to).toBe(5)
  })

  it('applies externally restored body without publishing another edit', async () => {
    const changes = vi.fn()
    const { rerender } = render(<ArticleRichEditor label="Test body" editable content={createArticleBody('Original')} onChange={changes} />)
    await screen.findByRole('textbox', { name: 'Test body' })
    changes.mockClear()
    rerender(<ArticleRichEditor label="Test body" editable content={createArticleBody('Restored by undo')} onChange={changes} />)
    expect(editorInstance().getText()).toBe('Restored by undo')
    expect(changes).not.toHaveBeenCalled()
  })

  it('real table command emits validator-compatible table JSON', async () => {
    const changes = vi.fn()
    render(<Harness onChange={changes} />)
    await screen.findByRole('textbox', { name: 'Test body' })
    fireEvent.click(screen.getByRole('button', { name: '表格' }))
    await waitFor(() => expect(changes).toHaveBeenCalled())
    expect(validateArticleBody(editorInstance().getJSON()), JSON.stringify(editorInstance().getJSON())).not.toBeNull()
    expect(document.querySelectorAll('.tiptap table tr')).toHaveLength(3)
    expect(document.querySelectorAll('.tiptap th')).toHaveLength(3)
  })

  it('inserts image through actual form and keeps valid JSON', async () => {
    render(<Harness />)
    await screen.findByRole('textbox', { name: 'Test body' })
    fireEvent.click(screen.getByRole('button', { name: '图片' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '资源地址' }), { target: { value: '/api/assets/test.png' } })
    fireEvent.change(screen.getByRole('textbox', { name: '图片说明' }), { target: { value: 'Figure' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(document.querySelector('.tiptap img')?.getAttribute('src')).toBe('/api/assets/test.png'))
    expect(validateArticleBody(editorInstance().getJSON())).not.toBeNull()
  })

  it('inserts math through actual form and keeps valid JSON', async () => {
    render(<Harness />)
    await screen.findByRole('textbox', { name: 'Test body' })
    fireEvent.click(screen.getByRole('button', { name: '公式' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'LaTeX 公式' }), { target: { value: 'x^2 + y^2' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(JSON.stringify(editorInstance().getJSON())).toContain('blockMath'))
    expect(validateArticleBody(editorInstance().getJSON())).not.toBeNull()
  })

  it('lets undo key bubble to document history rather than a private editor history', async () => {
    const undo = vi.fn()
    render(<Harness onUndo={undo} />)
    const textbox = await screen.findByRole('textbox', { name: 'Test body' })
    act(() => { editorInstance().commands.insertContent('Changed') })
    const text = editorInstance().getText()
    fireEvent.keyDown(textbox, { key: 'z', ctrlKey: true })
    expect(undo).toHaveBeenCalledOnce()
    expect(editorInstance().getText()).toBe(text)
  })

  it('does not emit spurious updates on IME lifecycle and accepts composed text transaction', async () => {
    const changes = vi.fn()
    render(<Harness onChange={changes} />)
    const textbox = await screen.findByRole('textbox', { name: 'Test body' })
    changes.mockClear()
    fireEvent.compositionStart(textbox, { data: '' })
    expect(changes).not.toHaveBeenCalled()
    act(() => { editorInstance().commands.insertContent('输入') })
    fireEvent.compositionEnd(textbox, { data: '输入' })
    expect(editorInstance().getText()).toContain('输入')
    expect(validateArticleBody(editorInstance().getJSON())).not.toBeNull()
  })
})
