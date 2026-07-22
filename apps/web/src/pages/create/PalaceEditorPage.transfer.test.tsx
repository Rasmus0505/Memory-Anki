import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/shared/feedback/toast'
import * as palaceApi from '@/modules/content/public'
import { serializeMindMapTransferFile } from '@/modules/content/public'
import {
  fireEvent,
  getMindMapTexts,
  renderPalaceEditPage,
  screen,
  setupPalaceEditPageTestDefaults,
  waitFor,
} from '@/pages/create/PalaceEditorPage.test-support'

const currentResponse = {
  palace: {
    id: 101,
    title: '测试宫殿',
    description: '',
    created_at: null,
    attachments: [],
    chapters: [],
  },
  editor_doc: {
    root: {
      data: { text: '测试宫殿', uid: 'root-1' },
      children: [{ data: { text: '原节点', uid: 'node-1' }, children: [] }],
    },
  },
  editor_config: { zoom: 1 },
  editor_local_config: { viewport: 'current-device' },
  lang: 'zh',
  editor_fingerprint: 'revision-current',
}

function makeTransferFile(name = 'incoming.json') {
  const content = serializeMindMapTransferFile({
    document: {
      root: {
        data: { text: '外部脑图', uid: 'import-root' },
        children: [{ data: { text: '导入节点', uid: 'import-child' }, children: [] }],
      },
    },
    sourceTitle: '外部脑图',
    exportedAt: '2026-07-14T07:30:00.000Z',
  })
  const file = new File([content], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) })
  return file
}

describe('PalaceEditorPage mind-map file transfer', () => {
  beforeEach(() => {
    setupPalaceEditPageTestDefaults()
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue(currentResponse as never)
  })

  it('exports the current document as a native JSON download', async () => {
    const successToast = vi.spyOn(toast, 'success').mockImplementation(() => 0)
    const createObjectURL = vi.fn((blob: Blob) => { void blob; return 'blob:mindmap-export' })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderPalaceEditPage()
    await screen.findByText('root-测试宫殿')

    fireEvent.click(screen.getByRole('button', { name: '导出脑图' }))

    expect(click).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mindmap-export')
    expect(successToast).toHaveBeenCalledWith('脑图已导出')
  })

  it('does not save when replacement import is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const save = vi.spyOn(palaceApi, 'savePalaceEditorApi')

    renderPalaceEditPage()
    await screen.findByText('root-测试宫殿')

    fireEvent.click(screen.getByRole('button', { name: '导入脑图' }))
    const input = screen.getByLabelText('选择要导入的脑图文件') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeTransferFile()] } })

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0]?.[0]).toContain('知识点数：2')
    expect(save).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('replaces only the document and preserves current editor state fields', async () => {
    const savedResponse = {
      ...currentResponse,
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'import-root', memoryAnkiRootKind: 'palace' },
          children: [{ data: { text: '导入节点', uid: 'import-child' }, children: [] }],
        },
      },
      editor_fingerprint: 'revision-imported',
    }
    const save = vi.spyOn(palaceApi, 'savePalaceEditorApi').mockResolvedValue(savedResponse as never)

    renderPalaceEditPage()
    await screen.findByText('root-测试宫殿')

    fireEvent.click(screen.getByRole('button', { name: '导入脑图' }))
    fireEvent.change(screen.getByLabelText('选择要导入的脑图文件'), {
      target: { files: [makeTransferFile()] },
    })

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith(101, expect.objectContaining({
      editor_doc: expect.objectContaining({
        root: expect.objectContaining({
          children: [expect.objectContaining({ data: expect.objectContaining({ text: '导入节点' }) })],
        }),
      }),
      editor_config: { zoom: 1 },
      editor_local_config: { viewport: 'current-device' },
      lang: 'zh',
      editor_fingerprint: 'revision-current',
      editor_source: 'import_apply',
      sync_reason: 'import_apply',
      allow_stale_overwrite: true,
    }))
  })

  it('keeps the current document after an import save failure and accepts the same file again', async () => {
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    const save = vi.spyOn(palaceApi, 'savePalaceEditorApi').mockRejectedValue(new Error('保存失败'))

    renderPalaceEditPage()
    await screen.findByText('root-测试宫殿')

    const input = screen.getByLabelText('选择要导入的脑图文件') as HTMLInputElement
    const file = makeTransferFile()
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('保存失败'))
    expect(getMindMapTexts().root).toBe('root-测试宫殿')
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  })
})