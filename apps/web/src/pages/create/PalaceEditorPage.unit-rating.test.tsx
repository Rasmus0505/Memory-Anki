import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/modules/content/domain/palace-entity/api'
import {
  queueReviewUnits,
  renderPalaceEditPage,
  setupPalaceEditPageTestDefaults,
} from './PalaceEditorPage.test-support'

function projection() {
  return {
    palace_id: 101,
    title: '测试宫殿',
    mark_required: false,
    unit_count: 3,
    due_unit_count: 1,
    next_review_date: '2026-10-30',
    review_status: 'due',
    units: [
      {
        id: 'unit-1',
        palace_id: 101,
        anchor_uid: 'root',
        unit_kind: 'marked',
        title: '单元一',
        node_uids: ['root'],
        revision: 1,
        stage_index: 3,
        interval_days: 7,
        has_passed: true,
        due_date: '2026-10-30',
        due: true,
      },
    ],
  }
}

beforeEach(() => {
  setupPalaceEditPageTestDefaults()
  vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
    palace: {
      id: 101,
      title: '测试宫殿',
      description: '',
      created_at: null,
      attachments: [],
      subjects: [],
      explicit_chapter_ids: [],
      inherited_chapter_ids: [],
      binding_revision: 0,
      chapters: [],
    },
    editor_doc: {
      root: {
        data: { uid: 'root', text: '测试宫殿' },
        children: [{ data: { uid: 'child', text: '内容' }, children: [] }],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  } as never)
})

describe('单元评分 entry', () => {
  it('sits above the palace directory and opens the rating page', async () => {
    queueReviewUnits(projection())

    renderPalaceEditPage()

    const entry = await screen.findByTestId('open-unit-rating')
    expect(entry.textContent).toContain('单元评分')
    // The count is loaded on first need, not on every editor mount.
    fireEvent.pointerEnter(entry)
    await waitFor(() => expect(entry.textContent).toContain('1 个今天到期'))

    fireEvent.click(entry)
    expect(await screen.findByText('unit-rating-page')).toBeTruthy()
  })
})
