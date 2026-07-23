import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as knowledgeApi from '@/modules/content/domain/knowledge-entity/api'
import * as palaceApi from '@/modules/content/domain/palace-entity/api'
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
  vi.spyOn(knowledgeApi, 'getSubjectTreeApi').mockResolvedValue({
    subject: { id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 },
    chapters: [],
  } as never)
  vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([
    { id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 },
  ])
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

  it('keeps a newly bound subject after editor reload returns subjects', async () => {
    vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([
      { id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 },
      { id: 7, name: '外国教育史', color: '#2563eb', sort_order: 1 },
    ])
    vi.spyOn(palaceApi, 'updatePalaceKnowledgeBindingApi').mockResolvedValue({
      palace_id: 101,
      subjects: [
        { id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 },
        { id: 7, name: '外国教育史', color: '#2563eb', sort_order: 1 },
      ],
      explicit_chapter_ids: [],
      inherited_chapter_ids: [],
      primary_chapter_id: null,
      binding_revision: 1,
    })
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValueOnce({
      palace: {
        id: 101, title: '俄国近代教育', description: '', created_at: null, attachments: [],
        subjects: [{ id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 }],
        explicit_chapter_ids: [], inherited_chapter_ids: [], binding_revision: 0, chapters: [],
      },
      editor_doc: { root: { data: { text: '俄国近代教育', uid: 'palace-root' }, children: [] } },
      editor_config: {}, editor_local_config: {}, lang: 'zh',
    } as never).mockResolvedValue({
      palace: {
        id: 101, title: '俄国近代教育', description: '', created_at: null, attachments: [],
        subjects: [
          { id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 },
          { id: 7, name: '外国教育史', color: '#2563eb', sort_order: 1 },
        ],
        explicit_chapter_ids: [], inherited_chapter_ids: [], binding_revision: 1, chapters: [],
      },
      editor_doc: { root: { data: { text: '俄国近代教育', uid: 'palace-root' }, children: [] } },
      editor_config: {}, editor_local_config: {}, lang: 'zh',
    } as never)

    renderPalaceEditPage()
    await screen.findByText('学科与思维导图')
    const foreignOption = await screen.findByRole('option', { name: '外国教育史' })
    const subjectSelect = foreignOption.closest('select')
    expect(subjectSelect).toBeTruthy()
    fireEvent.change(subjectSelect as HTMLSelectElement, { target: { value: '7' } })

    await waitFor(() =>
      expect(palaceApi.updatePalaceKnowledgeBindingApi).toHaveBeenCalledWith(
        101,
        expect.objectContaining({ subject_ids: [1, 7], base_revision: 0 }),
      ),
    )
    expect(await screen.findByRole('button', { name: '外国教育史' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除学科 外国教育史' })).toBeTruthy()
  })

  it('binds a chapter from the subject chapter tree without opening link mode', async () => {
    vi.spyOn(knowledgeApi, 'getSubjectTreeApi').mockResolvedValue({
      subject: { id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 },
      chapters: [
        { id: 11, name: '第一章 总论', parent_id: null, subject_id: 1, children: [] },
        { id: 12, name: '第二章 展开', parent_id: null, subject_id: 1, children: [] },
      ],
    } as never)
    vi.spyOn(palaceApi, 'updatePalaceKnowledgeBindingApi').mockResolvedValue({
      palace_id: 101,
      subjects: [{ id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 }],
      explicit_chapter_ids: [11],
      inherited_chapter_ids: [],
      primary_chapter_id: 11,
      binding_revision: 1,
    })

    renderPalaceEditPage()
    await screen.findByText('绑定章节')
    fireEvent.click(await screen.findByRole('checkbox', { name: '关联章节 第一章 总论' }))

    await waitFor(() =>
      expect(palaceApi.updatePalaceKnowledgeBindingApi).toHaveBeenCalledWith(
        101,
        expect.objectContaining({
          subject_ids: [1],
          chapter_ids: [11],
          primary_chapter_id: 11,
          base_revision: 0,
        }),
      ),
    )
  })
})
