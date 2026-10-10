import { describe, expect, it } from 'vitest'
import type { PalaceEditorResponse, PalaceQuizQuestion } from '@/shared/api/contracts'
import {
  forgetPalaceQuestion,
  installStudyTextLibraryForTest,
  peekPalaceEditor,
  peekPalaceQuestions,
  rememberPalaceEditorDraft,
  rememberPalaceQuestion,
  resetStudyTextLibraryForTest,
} from './studyTextLibrary'

function editor(id: number, text: string): PalaceEditorResponse {
  return {
    palace: { id, title: text },
    editor_doc: { root: { data: { text, uid: 'root' }, children: [] } },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  } as unknown as PalaceEditorResponse
}

describe('studyTextLibrary', () => {
  it('serves a palace from the prepared snapshot and keeps a local edit', () => {
    resetStudyTextLibraryForTest()
    installStudyTextLibraryForTest({
      editors: [editor(7, '原来的标题')],
      questions_by_palace: { 7: [{ id: 3, palace_id: 7, stem: '旧题' } as PalaceQuizQuestion] },
      bindings_by_palace: {},
      grouped: { groups: [], ungrouped: [], subjects: [] },
      subjects: { items: [] },
    })

    expect(peekPalaceEditor(7)?.palace.title).toBe('原来的标题')
    rememberPalaceEditorDraft(7, {
      editor_doc: { root: { data: { text: '刚改的', uid: 'root' }, children: [] } },
    })
    expect(peekPalaceEditor(7)?.editor_doc).toMatchObject({
      root: { data: { text: '刚改的' } },
    })

    rememberPalaceQuestion({ id: 3, palace_id: 7, stem: '刚改的题' } as PalaceQuizQuestion)
    expect(peekPalaceQuestions(7)?.[0]?.stem).toBe('刚改的题')
    forgetPalaceQuestion(3)
    expect(peekPalaceQuestions(7)).toEqual([])
  })
})
