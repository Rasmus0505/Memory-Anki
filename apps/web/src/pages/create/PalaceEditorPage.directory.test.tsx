import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as knowledgeApi from '@/modules/content/domain/knowledge-entity/api'
import * as palaceApi from '@/modules/content/domain/palace-entity/api'
import type { PalaceGroupedListResponse } from '@/shared/api/contracts'
import {
  fireEvent, renderPalaceEditPage, renderPalaceEditPageWithShell, screen,
  setupPalaceEditPageTestDefaults, waitFor,
} from './PalaceEditorPage.test-support'

const subject = { id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 }

function editorResponse(id: number, title: string) {
  return {
    palace: {
      id,
      title,
      description: '',
      created_at: null,
      attachments: [],
      subjects: [subject],
      explicit_chapter_ids: [],
      inherited_chapter_ids: [],
      binding_revision: 0,
      chapters: [],
    },
    editor_doc: { root: { data: { text: title, uid: `root-${id}` }, children: [] } },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  } as never
}

function palaceItem(id: number, title: string, chapterId: number) {
  return {
    id,
    title,
    resolved_title: title,
    description: '',
    created_at: null,
    next_review_at: null,
    has_due_review: false,
    review_status: 'scheduled' as const,
    review_unit_count: 0,
    due_review_unit_count: 0,
    permanent_mark_count: 0,
    title_mode: 'sync',
    manual_title: '',
    grouping_mode: 'auto',
    manual_group_chapter_id: null,
    binding_status: 'bound',
    primary_chapter_id: chapterId,
    primary_chapter: null,
    resolved_subject: subject,
    resolved_parent_chapter: null,
    group_id: null,
    group_sort_order: 0,
  }
}

function groupedWithBothPalaces(): PalaceGroupedListResponse {
  return {
    groups: [],
    ungrouped: [],
    subjects: [
      {
        subject,
        chapter_groups: [
          {
            source_chapter: { id: 10, name: '第一章 总论', subject_id: 1, parent_id: null },
            palaces: [palaceItem(101, '测试宫殿', 10), palaceItem(2, '别的宫殿', 10)],
          },
        ],
        ungrouped_palaces: [],
      },
    ],
  } as unknown as PalaceGroupedListResponse
}

function mockDirectory() {
  vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([subject])
  vi.spyOn(knowledgeApi, 'getSubjectTreeApi').mockResolvedValue({
    subject,
    chapters: [{ id: 10, name: '第一章 总论', parent_id: null, subject_id: 1, children: [] }],
  } as never)
  vi.spyOn(palaceApi, 'getPalacesGroupedApi').mockResolvedValue(groupedWithBothPalaces())
}

function makeDataTransfer() {
  const store = new Map<string, string>()
  const dataTransfer = {
    types: [] as string[],
    dropEffect: 'none',
    effectAllowed: 'all',
    setData(key: string, value: string) {
      store.set(key, value)
      if (!dataTransfer.types.includes(key)) dataTransfer.types.push(key)
    },
    getData(key: string) {
      return store.get(key) ?? ''
    },
    setDragImage() {},
  }
  return dataTransfer
}

beforeEach(() => {
  setupPalaceEditPageTestDefaults()
  vi.spyOn(palaceApi, 'getPalaceEditorApi').mockImplementation(async (id: number) =>
    editorResponse(id, id === 101 ? '测试宫殿' : '别的宫殿'))
  mockDirectory()
})

describe('Palace editor directory tree', () => {
  it('replaces the old binding sidebar with the directory tree', async () => {
    renderPalaceEditPage()

    expect(await screen.findByText('记忆宫殿')).toBeTruthy()
    expect(await screen.findByRole('button', { name: '测试宫殿' })).toBeTruthy()
    expect(screen.queryByText('宫殿字段')).toBeNull()
    expect(screen.queryByText('管理章节绑定')).toBeNull()
    expect(screen.queryByRole('button', { name: /移除学科/ })).toBeNull()
  })

  it('folds together with the app navigation so one button clears the left side', async () => {
    renderPalaceEditPageWithShell(true)

    const heading = await screen.findByText('记忆宫殿')
    expect(heading.closest('aside')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('opens another palace in place without leaving the editor route', async () => {
    renderPalaceEditPage()

    fireEvent.click(await screen.findByRole('button', { name: '别的宫殿' }))

    await waitFor(() => expect(palaceApi.getPalaceEditorApi).toHaveBeenCalledWith(2))
    expect(await screen.findByRole('button', { name: '别的宫殿' })).toBeTruthy()
  })

  it('moves a dragged palace onto a chapter through the binding command', async () => {
    vi.spyOn(palaceApi, 'getPalaceApi').mockResolvedValue({
      id: 101,
      title: '测试宫殿',
      description: '',
      attachments: [],
      subjects: [subject],
      explicit_chapter_ids: [],
      binding_revision: 3,
    } as never)
    vi.spyOn(palaceApi, 'updatePalaceKnowledgeBindingApi').mockResolvedValue({
      palace_id: 101,
      subjects: [subject],
      explicit_chapter_ids: [10],
      inherited_chapter_ids: [],
      primary_chapter_id: 10,
      binding_revision: 4,
    } as never)

    renderPalaceEditPage()

    const palaceRow = await screen.findByRole('button', { name: '测试宫殿' })
    const chapterLabel = await screen.findByRole('button', { name: '第一章 总论' })
    const dataTransfer = makeDataTransfer()

    fireEvent.dragStart(palaceRow, { dataTransfer })
    fireEvent.drop(chapterLabel.parentElement as HTMLElement, { dataTransfer })

    await waitFor(() =>
      expect(palaceApi.updatePalaceKnowledgeBindingApi).toHaveBeenCalledWith(
        101,
        expect.objectContaining({
          subject_ids: [1],
          chapter_ids: [10],
          primary_chapter_id: 10,
          base_revision: 3,
        }),
      ),
    )
  })
})
