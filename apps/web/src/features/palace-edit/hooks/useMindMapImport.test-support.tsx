import * as React from 'react'
import { vi } from 'vitest'
import { useMindMapImport } from '@/features/palace-edit/hooks/useMindMapImport'
import type { MindMapEditorState, MindMapImportJob } from '@/shared/api/contracts'
import * as knowledgeApi from '@/shared/api/modules/knowledge'
import * as palaceApi from '@/shared/api/modules/palaces'
import * as profileApi from '@/shared/api/modules/profile'

export function buildEditorState(): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: { text: 'Root', uid: 'root-1' },
        children: [{ data: { text: 'A', uid: 'a-1' }, children: [] }],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

export function buildEditorDoc(rootText: string, childText = 'B') {
  return {
    root: {
      data: { text: rootText, uid: `${rootText}-root` },
      children: [{ data: { text: childText, uid: `${rootText}-child` }, children: [] }],
    },
  }
}

export function buildUsage() {
  return {
    structure: 1,
    ocr: 0,
    merge: 1,
    text: 0,
    total: 2,
  }
}

export function buildJob(
  overrides: Partial<MindMapImportJob> & Pick<MindMapImportJob, 'id' | 'source_kind' | 'mode'>,
): MindMapImportJob {
  return {
    id: overrides.id,
    entity_key: 'palace_1',
    status: 'completed',
    stage: 'completed',
    resumable: false,
    source_kind: overrides.source_kind,
    mode: overrides.mode,
    source_meta: {},
    result: null,
    error: null,
    usage: buildUsage(),
    created_at: '2026-05-30T10:00:00',
    updated_at: '2026-05-30T10:00:00',
    started_at: '2026-05-30T10:00:00',
    completed_at: '2026-05-30T10:00:01',
    ...overrides,
  }
}

export function buildMindmapJob(
  id: string,
  rootText: string,
  title = rootText,
  overrides?: Partial<MindMapImportJob>,
): MindMapImportJob {
  return buildJob({
    id,
    source_kind: 'image-single',
    mode: 'mindmap',
    result: {
      source_tree: {
        title,
        children: [{ text: '新增节点', children: [] }],
      },
      editor_doc: buildEditorDoc(rootText),
      warnings: [],
      can_apply: true,
      match_mode: 'strict_match',
    },
    ...overrides,
  })
}

export function buildBatchJob(
  id: string,
  rootText: string,
  overrides?: Partial<MindMapImportJob>,
): MindMapImportJob {
  return buildJob({
    id,
    source_kind: 'image-batch',
    mode: 'mindmap',
    result: {
      source_tree: {
        title: rootText,
        children: [{ text: '章节一', children: [{ text: '补充点', children: [] }] }],
      },
      editor_doc: buildEditorDoc(rootText, '章节一'),
      structure_image_index: 0,
      image_count: 2,
      warnings: [],
      can_apply: true,
      match_mode: 'strict_match',
    },
    ...overrides,
  })
}

export function buildPdfJob(
  id: string,
  rootText: string,
  overrides?: Partial<MindMapImportJob>,
): MindMapImportJob {
  return buildJob({
    id,
    source_kind: 'subject-pdf',
    mode: 'mindmap',
    result: {
      source_tree: {
        title: rootText,
        children: [{ text: '第一节', children: [] }],
      },
      editor_doc: buildEditorDoc(rootText, '第一节'),
      selected_pages: [1, 3],
      warnings: [],
      can_apply: true,
      match_mode: 'direct_generation',
    },
    ...overrides,
  })
}

export function buildTextJob(
  id: string,
  text: string,
  overrides?: Partial<MindMapImportJob>,
): MindMapImportJob {
  return buildJob({
    id,
    source_kind: 'image-single',
    mode: 'text',
    usage: {
      structure: 0,
      ocr: 0,
      merge: 0,
      text: 1,
      total: 1,
    },
    result: {
      extracted_text: text,
      warnings: [],
      can_apply: false,
      match_mode: 'strict_match',
    },
    ...overrides,
  })
}

export function cloneJob<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function Harness({
  applyEditorState,
}: {
  applyEditorState?: (nextState: MindMapEditorState, context?: unknown) => Promise<void> | void
}) {
  const [editorState, setEditorState] = React.useState<MindMapEditorState | null>(buildEditorState())
  const model = useMindMapImport({
    entityKey: 'palace_1',
    editorState,
    setEditorState: (nextState) => setEditorState(nextState),
    applyEditorState,
    selectedNodeUid: 'a-1',
    subjectOptions: [{ id: 4, name: '外国教育史' }],
    defaultSubjectId: 4,
  })

  return (
    <div>
      <div data-testid="sync-version">{model.importAppliedSyncVersion}</div>
      <div data-testid="batch-count">{model.importBatchImages.length}</div>
      <div data-testid="batch-status">{model.importBatchStatus}</div>
      <div data-testid="pdf-pages">{model.importPdfPages.join(',')}</div>
      <div data-testid="pdf-doc-id">{model.importSelectedSubjectDocumentId ?? ''}</div>
      <div data-testid="pdf-mode">{model.importPdfMode}</div>
      <div data-testid="extracted-text">{model.importExtractedText}</div>
      <div data-testid="current-job-id">{model.currentJobId ?? ''}</div>
      <div data-testid="current-job-status">{model.currentJobStatus ?? ''}</div>
      <div data-testid="current-job-stage">{model.currentJobStage ?? ''}</div>
      <div data-testid="current-job-pause-requested">{String(model.currentJobPauseRequested)}</div>
      <div data-testid="can-resume">{String(model.canResumeJob)}</div>
      <div data-testid="can-pause">{String(model.canPauseJob)}</div>
      <div data-testid="reused-result">{String(model.importReusedExistingResult)}</div>
      <div data-testid="history-count">{model.importHistoryJobs.length}</div>
      <div data-testid="preview-doc-root">
        {String(
          (typeof model.importPreviewEditorDoc === 'object' &&
            model.importPreviewEditorDoc &&
            'root' in model.importPreviewEditorDoc &&
            typeof model.importPreviewEditorDoc.root === 'object' &&
            model.importPreviewEditorDoc.root &&
            'data' in model.importPreviewEditorDoc.root &&
            typeof model.importPreviewEditorDoc.root.data === 'object' &&
            model.importPreviewEditorDoc.root.data &&
            'text' in model.importPreviewEditorDoc.root.data &&
            typeof model.importPreviewEditorDoc.root.data.text === 'string'
            ? model.importPreviewEditorDoc.root.data.text
            : '') ?? '',
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          const file = new File(['x'], 'test.png', { type: 'image/png' })
          const event = {
            target: { files: [file], value: '' },
          } as unknown as React.ChangeEvent<HTMLInputElement>
          model.handleImportFileChange(event)
        }}
      >
        load
      </button>
      <button type="button" onClick={() => void model.setImportOpen(true)}>
        open
      </button>
      <button type="button" onClick={() => void model.handleResumeJob()}>
        resume
      </button>
      <button type="button" onClick={() => void model.handlePauseJob()}>
        pause
      </button>
      <button type="button" onClick={() => model.setMindMapImportWorkflow('batch')}>
        enable-batch
      </button>
      <button type="button" onClick={() => model.setImportMode('text')}>
        enable-text
      </button>
      <button
        type="button"
        onClick={() => {
          const fileOne = new File(['a'], 'one.png', { type: 'image/png' })
          const fileTwo = new File(['b'], 'two.png', { type: 'image/png' })
          const event = {
            target: { files: [fileOne, fileTwo], value: '' },
          } as unknown as React.ChangeEvent<HTMLInputElement>
          model.handleImportFileChange(event)
        }}
      >
        queue-batch
      </button>
      <button type="button" onClick={() => void model.handleBatchImportStart()}>
        start-batch
      </button>
      <button type="button" onClick={() => model.setImportSourceKind('subject-pdf')}>
        enable-pdf
      </button>
      <button type="button" onClick={() => model.setImportPdfPageInput('1,3')}>
        set-pdf-pages
      </button>
      <button type="button" onClick={() => model.setImportStructurePage(3)}>
        set-structure-page
      </button>
      <button type="button" onClick={() => model.setImportPdfMode('structured_merge')}>
        enable-structured-pdf
      </button>
      <button type="button" onClick={() => model.setImportRangePrompt('第一节 东方文明古国的教育')}>
        set-range-prompt
      </button>
      <button type="button" onClick={() => void model.handlePdfImportStart()}>
        start-pdf
      </button>
      <button type="button" onClick={model.handleImportApplyReplace}>
        replace
      </button>
      <button type="button" onClick={model.handleUndoLastImport}>
        undo
      </button>
    </div>
  )
}

export interface UseMindMapImportTestContext {
  jobsById: Record<string, MindMapImportJob>
  nextImageJobFactory: (mode: 'mindmap' | 'text') => MindMapImportJob
  nextBatchJobFactory: () => MindMapImportJob
  nextPdfJobFactory: () => MindMapImportJob
  runJobFactory: (jobId: string) => MindMapImportJob
  getJobFactory: (jobId: string) => MindMapImportJob
}

export function setupUseMindMapImportTestContext(): UseMindMapImportTestContext {
  vi.restoreAllMocks()
  localStorage.clear()

  const context = {} as UseMindMapImportTestContext
  context.jobsById = {}
  context.nextImageJobFactory = (mode) =>
    mode === 'text'
      ? buildTextJob('job-text', '第一章\n第一节')
      : buildMindmapJob('job-single', 'Imported', '导入脑图')
  context.nextBatchJobFactory = () => buildBatchJob('job-batch', 'Batch Imported')
  context.nextPdfJobFactory = () => buildPdfJob('job-pdf', 'PDF Imported')
  context.runJobFactory = (jobId) => cloneJob(context.jobsById[jobId])
  context.getJobFactory = (jobId) => cloneJob(context.jobsById[jobId])

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  })

  vi.spyOn(knowledgeApi, 'getSubjectDocumentsApi').mockResolvedValue({
    items: [
      {
        id: 11,
        subject_id: 4,
        filename: 'subjects/4/test.pdf',
        original_name: 'test.pdf',
        mime_type: 'application/pdf',
        file_size: 128,
        page_count: 3,
        created_at: '2026-05-26T10:00:00',
      },
    ],
  } as never)
  vi.spyOn(knowledgeApi, 'getSubjectDocumentPagesApi').mockResolvedValue({
    page_count: 3,
    pages: [
      { page_number: 1, thumbnail_url: '/thumb-1', preview_url: '/preview-1' },
      { page_number: 2, thumbnail_url: '/thumb-2', preview_url: '/preview-2' },
      { page_number: 3, thumbnail_url: '/thumb-3', preview_url: '/preview-3' },
    ],
  } as never)
  vi.spyOn(profileApi, 'getReviewSettingsApi').mockResolvedValue({
    default_algorithm: 'ebbinghaus',
    default_review_mode: 'flashcard',
    custom_intervals: '1,2,4,7,15,30,60',
    algorithm_change_scope: 'future_only',
    sleep_review_time: '22:00',
    early_review_anchor: 'true',
    ebbinghaus_intervals: '1h,sleep,1,2,4,7,15,30,60',
    daily_max_reviews: '0',
    mastered_interval: '180',
    auto_smooth_overdue: 'true',
    overdue_smoothing_days: '7',
    overdue_smoothing_threshold: '5',
    time_recording_threshold_seconds: '0',
    import_pdf_quote_original_default: 'true',
    import_pdf_mount_leaf_only_default: 'true',
    import_pdf_preserve_emphasis_default: 'true',
    import_pdf_semantic_split_default: 'true',
    import_pdf_preserve_line_breaks_default: 'true',
  } as never)
  vi.spyOn(profileApi, 'updateReviewSettingsApi').mockResolvedValue({
    default_algorithm: 'ebbinghaus',
    default_review_mode: 'flashcard',
    custom_intervals: '1,2,4,7,15,30,60',
    algorithm_change_scope: 'future_only',
    sleep_review_time: '22:00',
    early_review_anchor: 'true',
    ebbinghaus_intervals: '1h,sleep,1,2,4,7,15,30,60',
    daily_max_reviews: '0',
    mastered_interval: '180',
    auto_smooth_overdue: 'true',
    overdue_smoothing_days: '7',
    overdue_smoothing_threshold: '5',
    time_recording_threshold_seconds: '0',
    import_pdf_quote_original_default: 'true',
    import_pdf_mount_leaf_only_default: 'true',
    import_pdf_preserve_emphasis_default: 'true',
    import_pdf_semantic_split_default: 'true',
    import_pdf_preserve_line_breaks_default: 'true',
  } as never)

  vi.spyOn(palaceApi, 'createImageImportJobApi').mockImplementation(async (_file, options) => {
    const job = cloneJob(context.nextImageJobFactory(options.mode))
    context.jobsById[job.id] = job
    return cloneJob(job)
  })
  vi.spyOn(palaceApi, 'createBatchImportJobApi').mockImplementation(async () => {
    const job = cloneJob(context.nextBatchJobFactory())
    context.jobsById[job.id] = job
    return cloneJob(job)
  })
  vi.spyOn(palaceApi, 'createPdfImportJobApi').mockImplementation(async () => {
    const job = cloneJob(context.nextPdfJobFactory())
    context.jobsById[job.id] = job
    return cloneJob(job)
  })
  vi.spyOn(palaceApi, 'runImportJobApi').mockImplementation(async (jobId) => {
    const job = cloneJob(context.runJobFactory(jobId))
    context.jobsById[job.id] = job
    return cloneJob(job)
  })
  vi.spyOn(palaceApi, 'pauseImportJobApi').mockImplementation(async (jobId) => {
    const existing = cloneJob(context.jobsById[jobId])
    const pausedJob = {
      ...existing,
      pause_requested: true,
    }
    context.jobsById[jobId] = pausedJob
    return cloneJob(pausedJob)
  })
  vi.spyOn(palaceApi, 'getImportJobApi').mockImplementation(async (jobId) => {
    const job = cloneJob(context.getJobFactory(jobId))
    context.jobsById[job.id] = job
    return cloneJob(job)
  })
  vi.spyOn(palaceApi, 'listImportJobsApi').mockImplementation(async (entityKey) => ({
    items: Object.values(context.jobsById)
      .filter((job) => job.entity_key === entityKey)
      .map((job) => cloneJob(job)),
  }))
  vi.spyOn(palaceApi, 'deleteImportJobApi').mockResolvedValue({
    ok: true,
    job: buildMindmapJob('deleted-job', 'Deleted'),
  } as never)

  return context
}
