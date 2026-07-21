import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as knowledgeApi from '@/entities/knowledge/api'
import * as palaceApi from '@/entities/palace/api'
import {
  fireEvent, renderPalaceEditPage, screen, setupPalaceEditPageTestDefaults, waitFor,
} from './PalaceEditorPage.test-support'

function mockPalaceWithSubject() {
  vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
    palace: {
      id: 101, title: '测试宫殿', description: '', created_at: null, attachments: [],
      subjects: [{ id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 }],
      explicit_chapter_ids: [], inherited_chapter_ids: [], binding_revision: 0, chapters: [],
    },
    editor_doc: { root: { data: { text: '测试宫殿', uid: 'palace-root' }, children: [] } },
    editor_config: {}, editor_local_config: {}, lang: 'zh',
  } as never)
  vi.spyOn(knowledgeApi, 'getSubjectEditorApi').mockResolvedValue({
    subject: { id: 1, name: '测试学科', color: '#6366f1' },
    editor_doc: { root: { data: { text: '测试学科', uid: 'subject-root', memoryAnkiRootKind: 'subject' }, children: [] } },
    editor_config: {}, editor_local_config: {}, lang: 'zh',
  } as never)
  vi.spyOn(knowledgeApi, 'saveSubjectEditorApi').mockResolvedValue({} as never)
}

describe('Palace knowledge workspace', () => {
  beforeEach(() => { setupPalaceEditPageTestDefaults(); mockPalaceWithSubject() })

  it('switches from the palace document to the independently persisted subject document', async () => {
    renderPalaceEditPage()
    await screen.findByText('学科与思维导图')
    fireEvent.click(screen.getByRole('button', { name: '测试学科' }))
    await waitFor(() => expect(knowledgeApi.getSubjectEditorApi).toHaveBeenCalledWith(1))
    expect(await screen.findByText(/scope-palace:101:subject:1/)).toBeTruthy()
  })

  it('removes a subject through the revisioned Palace binding command', async () => {
    vi.spyOn(palaceApi, 'updatePalaceKnowledgeBindingApi').mockResolvedValue({
      palace_id: 101, subjects: [{ id: 2, name: '未分类', color: '#94a3b8' }],
      explicit_chapter_ids: [], inherited_chapter_ids: [], primary_chapter_id: null, binding_revision: 1,
    })
    renderPalaceEditPage()
    fireEvent.click(await screen.findByRole('button', { name: '移除学科 测试学科' }))
    await waitFor(() => expect(palaceApi.updatePalaceKnowledgeBindingApi).toHaveBeenCalledWith(101, expect.objectContaining({ subject_ids: [], chapter_ids: [], base_revision: 0 })))
  })
})
