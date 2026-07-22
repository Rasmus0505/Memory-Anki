import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuizGenerationJob } from '@/shared/api/contracts'
import * as workspaceApi from '@/modules/quiz/ui/palace-quiz/api'
import {
  loadPersistentQuizGenerationHistory,
  persistQuizGenerationHistory,
} from '@/modules/quiz/ui/palace-quiz/model/persistQuizGenerationHistory'

function buildJob(overrides: Partial<QuizGenerationJob> = {}): QuizGenerationJob {
  return {
    id: 'job-1',
    palace_id: 1,
    selected_chapter_id: 2,
    status: 'preview',
    title: '题目.png',
    extra_prompt: '补充要求',
    options: {
      quick_generation: true,
      source_kind: 'image-single',
      ai_options: { model: 'qwen-test', prompt_override: '完整提示词' },
    },
    matching_items: [],
    preview: { questions: [], grouped_questions: null, ai_call_log_id: 'log-1' },
    error_message: '',
    sources: [],
    created_at: '2026-07-13T00:00:00',
    updated_at: '2026-07-13T00:00:00',
    ...overrides,
  } as QuizGenerationJob
}

describe('persistent quiz generation history', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('persists immutable run configuration, source files, and preview', async () => {
    vi.spyOn(workspaceApi, 'createQuizGenerationJobApi').mockResolvedValue({ item: buildJob({ status: 'draft' }) })
    vi.spyOn(workspaceApi, 'addQuizFileSourceApi').mockResolvedValue({} as never)
    vi.spyOn(workspaceApi, 'updateQuizGenerationJobApi').mockResolvedValue({ item: buildJob() })
    const file = new File(['image'], '题目.png', { type: 'image/png' })

    const history = await persistQuizGenerationHistory(
      1,
      buildJob().preview!,
      'image-single',
      [file],
      '补充要求',
      true,
      false,
      2,
      '生物 / 第二章',
      { model: 'qwen-test', thinking_enabled: false, prompt_override: '完整提示词' },
    )

    expect(workspaceApi.createQuizGenerationJobApi).toHaveBeenCalledWith(1, expect.objectContaining({
      options: expect.objectContaining({
        quick_generation: true,
        ai_options: expect.objectContaining({ prompt_override: '完整提示词' }),
      }),
    }))
    expect(workspaceApi.addQuizFileSourceApi).toHaveBeenCalledWith('job-1', 'question', file)
    expect(workspaceApi.updateQuizGenerationJobApi).toHaveBeenCalledWith('job-1', {
      status: 'preview',
      preview: buildJob().preview,
    })
    expect(history?.id).toBe('job-1')
  })

  it('loads only quick-generation jobs from server history', async () => {
    vi.spyOn(workspaceApi, 'listQuizGenerationJobsApi').mockResolvedValue({
      items: [buildJob(), buildJob({ id: 'workspace-job', options: {} })],
    })

    const history = await loadPersistentQuizGenerationHistory(1)

    expect(history.map((item) => item.id)).toEqual(['job-1'])
  })
})
