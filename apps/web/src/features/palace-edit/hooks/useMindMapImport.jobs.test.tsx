import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Harness,
  buildBatchJob,
  buildPdfJob,
  cloneJob,
  setupUseMindMapImportTestContext,
  type UseMindMapImportTestContext,
} from '@/features/palace-edit/hooks/useMindMapImport.test-support'
import * as palaceApi from '@/shared/api/modules/palaces'

describe('useMindMapImport job flows', () => {
  let context: UseMindMapImportTestContext

  beforeEach(() => {
    context = setupUseMindMapImportTestContext()
  })

  it('builds subject-pdf requests from selected pages and prompt', async () => {
    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('pdf-doc-id').textContent).toBe('11')
    })

    fireEvent.click(screen.getByRole('button', { name: 'enable-pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-pdf-pages' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-range-prompt' }))

    await waitFor(() => {
      expect(screen.getByTestId('pdf-pages').textContent).toBe('1,3')
      expect(screen.getByTestId('pdf-mode').textContent).toBe('direct_generation')
    })

    fireEvent.click(screen.getByRole('button', { name: 'start-pdf' }))
    await waitFor(() => {
      expect(palaceApi.createPdfImportJobApi).toHaveBeenCalledWith({
        entity_key: 'palace_1',
        mode: 'mindmap',
        subject_document_id: 11,
        page_selection: [1, 3],
        pdf_mode: 'direct_generation',
        structure_page: null,
        range_prompt: '第一节 东方文明古国的教育',
        fallback_title: 'test.pdf',
        import_options: {
          quote_original_text_only: true,
          mount_on_original_leaf_only: true,
          preserve_emphasis_marks: true,
          semantic_split_long_paragraphs: true,
          preserve_line_breaks: true,
        },
      })
    })
  })

  it('switches pdf import to structured merge only when explicitly selected', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'enable-pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'enable-structured-pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-pdf-pages' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-structure-page' }))

    await waitFor(() => {
      expect(screen.getByTestId('pdf-mode').textContent).toBe('structured_merge')
    })

    fireEvent.click(screen.getByRole('button', { name: 'start-pdf' }))
    await waitFor(() => {
      expect(palaceApi.createPdfImportJobApi).toHaveBeenCalledWith({
        entity_key: 'palace_1',
        mode: 'mindmap',
        subject_document_id: 11,
        page_selection: [1, 3],
        pdf_mode: 'structured_merge',
        structure_page: 3,
        range_prompt: '',
        fallback_title: 'test.pdf',
        import_options: expect.any(Object),
      })
    })
  })

  it('restores the preferred job from backend history after reopening', async () => {
    context.jobsById['job-old'] = buildPdfJob('job-old', 'Older Draft', {
      created_at: '2026-05-30T09:00:00',
    })
    context.jobsById['job-restore'] = buildPdfJob('job-restore', 'Restored Draft', {
      created_at: '2026-05-30T11:00:00',
    })

    render(<Harness />)
    localStorage.setItem('mindmap_import_last_job_palace_1', 'job-restore')

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-job-id').textContent).toBe('job-restore')
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Restored Draft')
      expect(screen.getByTestId('history-count').textContent).toBe('2')
    })
  })

  it('resumes a failed job and finishes through polling', async () => {
    const failedJob = buildBatchJob('job-failed', 'Batch Draft', {
      status: 'failed',
      stage: 'structure',
      resumable: true,
      result: null,
      error: {
        code: 'invalid_json',
        stage: 'structure',
        message: '模型返回内容不是有效 JSON。',
        retryable: true,
        raw_snippet: 'Internal Server Error',
      },
    })
    context.jobsById[failedJob.id] = failedJob
    context.runJobFactory = (jobId) =>
      buildBatchJob(jobId, 'Batch Draft', {
        status: 'running',
        stage: 'merge',
        resumable: false,
        result: null,
        error: null,
      })
    context.getJobFactory = (jobId) => buildBatchJob(jobId, 'Recovered Batch')
    localStorage.setItem('mindmap_import_last_job_palace_1', failedJob.id)

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-job-status').textContent).toBe('failed')
      expect(screen.getByTestId('can-resume').textContent).toBe('true')
    })

    fireEvent.click(screen.getByRole('button', { name: 'resume' }))
    await waitFor(() => {
      expect(palaceApi.runImportJobApi).toHaveBeenCalledWith('job-failed')
      expect(screen.getByTestId('current-job-status').textContent).toBe('completed')
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Recovered Batch')
    })
  })

  it('requests pause for a running job and keeps polling until the backend marks it paused', async () => {
    const runningJob = buildPdfJob('job-running', 'PDF Draft', {
      status: 'running',
      stage: 'merge',
      resumable: false,
      result: null,
      progress: {
        phase: 'merge',
        message: '正在把正文补到结构节点下',
        step: 4,
        total_steps: 4,
        preview_text: '{"title":"draft"}',
      },
    })
    context.jobsById[runningJob.id] = runningJob
    let pauseSettled = false
    vi.mocked(palaceApi.pauseImportJobApi).mockImplementation(async (jobId) => {
      pauseSettled = true
      const existing = cloneJob(context.jobsById[jobId])
      const nextJob = {
        ...existing,
        pause_requested: true,
      }
      context.jobsById[jobId] = nextJob
      return cloneJob(nextJob)
    })
    context.getJobFactory = (jobId) =>
      pauseSettled
        ? buildPdfJob(jobId, 'PDF Draft', {
            status: 'paused',
            stage: 'merge',
            resumable: true,
            result: null,
            pause_requested: false,
            progress: {
              phase: 'merge',
              message: '识别已暂停，可继续识别。',
              step: 4,
              total_steps: 4,
              preview_text: '{"title":"draft"}',
            },
          })
        : cloneJob(context.jobsById[jobId])

    render(<Harness />)
    localStorage.setItem('mindmap_import_last_job_palace_1', runningJob.id)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-job-status').textContent).toBe('running')
      expect(screen.getByTestId('can-pause').textContent).toBe('true')
    })

    fireEvent.click(screen.getByRole('button', { name: 'pause' }))
    await waitFor(() => {
      expect(palaceApi.pauseImportJobApi).toHaveBeenCalledWith('job-running')
      expect(screen.getByTestId('current-job-status').textContent).toBe('paused')
      expect(screen.getByTestId('can-resume').textContent).toBe('true')
    })
  })

  it('starts subject-pdf imports through background jobs instead of preview completion', async () => {
    context.nextPdfJobFactory = () =>
      buildPdfJob('job-pdf', 'PDF Imported', {
        status: 'draft',
        stage: 'prepared',
        result: null,
      })
    context.runJobFactory = (jobId) =>
      buildPdfJob(jobId, 'PDF Imported', {
        status: 'running',
        stage: 'merge',
        result: null,
      })
    context.getJobFactory = (jobId) => buildPdfJob(jobId, 'PDF Imported')

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('pdf-doc-id').textContent).toBe('11')
    })

    fireEvent.click(screen.getByRole('button', { name: 'enable-pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-pdf-pages' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-structure-page' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-range-prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-pdf' }))

    await waitFor(() => {
      expect(palaceApi.createPdfImportJobApi).toHaveBeenCalled()
      expect(palaceApi.runImportJobApi).toHaveBeenCalledWith('job-pdf')
    })
  })
})
