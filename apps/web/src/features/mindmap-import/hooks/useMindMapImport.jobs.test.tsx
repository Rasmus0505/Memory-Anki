import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Harness,
  buildBatchJob,
  cloneJob,
  setupUseMindMapImportTestContext,
  type UseMindMapImportTestContext,
} from '@/features/mindmap-import/hooks/useMindMapImport.test-support'
import * as importApi from '@/entities/knowledge-import/api'

describe('useMindMapImport job flows', () => {
  let context: UseMindMapImportTestContext

  beforeEach(() => {
    context = setupUseMindMapImportTestContext()
  })

  it('restores the preferred job from backend history after reopening', async () => {
    context.jobsById['job-old'] = buildBatchJob('job-old', 'Older Draft', {
      created_at: '2026-05-30T09:00:00',
    })
    context.jobsById['job-restore'] = buildBatchJob('job-restore', 'Restored Draft', {
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
      expect(importApi.runImportJobApi).toHaveBeenCalledWith('job-failed')
      expect(screen.getByTestId('current-job-status').textContent).toBe('completed')
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Recovered Batch')
    })
  })

  it('requests pause for a running job and keeps polling until the backend marks it paused', async () => {
    const runningJob = buildBatchJob('job-running', 'Batch Draft', {
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
    vi.mocked(importApi.pauseImportJobApi).mockImplementation(async (jobId) => {
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
        ? buildBatchJob(jobId, 'Batch Draft', {
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
      expect(importApi.pauseImportJobApi).toHaveBeenCalledWith('job-running')
      expect(screen.getByTestId('current-job-status').textContent).toBe('paused')
      expect(screen.getByTestId('can-resume').textContent).toBe('true')
    })
  })

})


