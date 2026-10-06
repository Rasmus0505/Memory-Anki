import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalaceQuizQuestion, QuizNodeBindingEdge } from '@/shared/api/contracts'
import { mutatePalaceQuizNodeBindingsApi } from '@/modules/quiz/domain/quiz-entity/api'
import { QuizNodeDeleteGuardDialog } from './QuizNodeDeleteGuardDialog'

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  mutatePalaceQuizNodeBindingsApi: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const editorDoc = {
  root: {
    data: { uid: 'root', text: '根节点' },
    children: [
      { data: { uid: 'child-a', text: '子A' }, children: [] },
      { data: { uid: 'child-b', text: '子B' }, children: [] },
    ],
  },
}

/** child-a / child-b live under section-a, which itself survives. */
const nestedEditorDoc = {
  root: {
    data: { uid: 'root', text: '根节点' },
    children: [
      {
        data: { uid: 'section-a', text: '章节A' },
        children: [
          { data: { uid: 'child-a', text: '子A' }, children: [] },
          { data: { uid: 'child-b', text: '子B' }, children: [] },
        ],
      },
      { data: { uid: 'section-b', text: '章节B' }, children: [] },
    ],
  },
}

const edges: QuizNodeBindingEdge[] = [
  { question_id: 11, node_uid: 'child-a', node_text: '子A', palace_id: 1 },
  { question_id: 12, node_uid: 'child-b', node_text: '子B', palace_id: 1 },
]

const questionById = new Map<number, PalaceQuizQuestion>([
  [11, { id: 11, stem: '题11' } as PalaceQuizQuestion],
  [12, { id: 12, stem: '题12' } as PalaceQuizQuestion],
])

function renderDialog(overrides?: {
  removedNodeUids?: readonly string[]
  doc?: typeof editorDoc
}) {
  const onResolve = vi.fn()
  render(
    <QuizNodeDeleteGuardDialog
      request={{
        removedNodeUids: overrides?.removedNodeUids ?? ['child-a', 'child-b'],
        affectedEdges: edges,
      }}
      palaceId={1}
      editorDoc={overrides?.doc ?? editorDoc}
      questionById={questionById}
      onResolve={onResolve}
    />,
  )
  return { onResolve }
}

describe('QuizNodeDeleteGuardDialog', () => {
  beforeEach(() => {
    vi.mocked(mutatePalaceQuizNodeBindingsApi).mockReset().mockResolvedValue({} as never)
  })

  it('defaults each binding to its nearest surviving ancestor and confirms a full rebind', async () => {
    const { onResolve } = renderDialog({ doc: nestedEditorDoc })

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects).toHaveLength(2)
    expect(selects.map((select) => select.value)).toEqual(['section-a', 'section-a'])
    expect(screen.getByText(/默认转到最近的上层卡片/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledTimes(1)
    })
    expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledWith(1, {
      remove: [
        { question_id: 11, node_uid: 'child-a' },
        { question_id: 12, node_uid: 'child-b' },
      ],
      add: [
        { question_id: 11, node_uid: 'section-a', reason: '删除卡片时转移绑定' },
        { question_id: 12, node_uid: 'section-a', reason: '删除卡片时转移绑定' },
      ],
    })
    expect(onResolve).toHaveBeenCalledWith(true)
  })

  it('falls back to the root when the whole ancestor chain is deleted', async () => {
    renderDialog({
      doc: nestedEditorDoc,
      removedNodeUids: ['section-a', 'child-a', 'child-b'],
    })

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects.map((select) => select.value)).toEqual(['root', 'root'])
  })

  it('defaults to the root when the deleted nodes are direct children of it', async () => {
    renderDialog()

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects.map((select) => select.value)).toEqual(['root', 'root'])
  })

  it('omits an unbound row from add when the empty option is chosen', async () => {
    renderDialog({ doc: nestedEditorDoc })

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(selects[0], { target: { value: '' } })
    expect(selects[0].value).toBe('')
    expect(selects[1].value).toBe('section-a')

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledTimes(1)
    })
    expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        add: [
          { question_id: 12, node_uid: 'section-a', reason: '删除卡片时转移绑定' },
        ],
      }),
    )
  })
})
