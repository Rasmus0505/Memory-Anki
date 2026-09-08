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

const edges: QuizNodeBindingEdge[] = [
  { question_id: 11, node_uid: 'child-a', node_text: '子A', palace_id: 1 },
  { question_id: 12, node_uid: 'child-b', node_text: '子B', palace_id: 1 },
]

const questionById = new Map<number, PalaceQuizQuestion>([
  [11, { id: 11, stem: '题11' } as PalaceQuizQuestion],
  [12, { id: 12, stem: '题12' } as PalaceQuizQuestion],
])

function renderDialog() {
  const onResolve = vi.fn()
  render(
    <QuizNodeDeleteGuardDialog
      request={{ removedNodeUids: ['child-a', 'child-b'], affectedEdges: edges }}
      palaceId={1}
      editorDoc={editorDoc}
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

  it('defaults every binding to the root node and confirms a full rebind', async () => {
    const { onResolve } = renderDialog()

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects).toHaveLength(2)
    expect(selects.map((select) => select.value)).toEqual(['root', 'root'])
    expect(screen.getByText(/默认转到根节点/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledTimes(1)
    })
    expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledWith(1, {
      remove: [
        { question_id: 11, node_uid: 'child-a', target_palace_id: 1 },
        { question_id: 12, node_uid: 'child-b', target_palace_id: 1 },
      ],
      add: [
        { question_id: 11, node_uid: 'root', target_palace_id: 1, reason: '删除卡片时转移绑定' },
        { question_id: 12, node_uid: 'root', target_palace_id: 1, reason: '删除卡片时转移绑定' },
      ],
    })
    expect(onResolve).toHaveBeenCalledWith(true)
  })

  it('omits an unbound row from add when the empty option is chosen', async () => {
    renderDialog()

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(selects[0], { target: { value: '' } })
    expect(selects[0].value).toBe('')
    expect(selects[1].value).toBe('root')

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledTimes(1)
    })
    expect(mutatePalaceQuizNodeBindingsApi).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        add: [
          { question_id: 12, node_uid: 'root', target_palace_id: 1, reason: '删除卡片时转移绑定' },
        ],
      }),
    )
  })
})
