import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type {
  AiRuntimeOptions,
  QuizGenerationJob,
  QuizMatchingItem,
  QuizPdfAsset,
  QuizSourceRole,
} from '@/shared/api/contracts'
import {
  addQuizFileSourceApi,
  addQuizPdfSourceApi,
  addQuizTextSourceApi,
  createQuizGenerationJobApi,
  deleteQuizGenerationJobApi,
  deleteQuizSourceApi,
  extractMatchQuizJobApi,
  generateQuizWorkspacePreviewApi,
  listQuizGenerationJobsApi,
  listQuizPdfAssetsApi,
  markQuizGenerationJobSavedApi,
  rematchQuizItemsApi,
  reorderQuizSourcesApi,
  updateQuizGenerationJobApi,
  updateQuizPdfAssetApi,
  deleteQuizPdfAssetApi,
  updateQuizMatchingApi,
  uploadQuizPdfAssetApi,
} from '@/modules/quiz/ui/palace-quiz/api'

interface Options {
  palaceId: number
  palace: { title: string; editor_doc?: Record<string, unknown> | string | null } | null
  selectedChapterId: number | null
  promptForAiOptions: (options: {
    scenarioKey: string
    entrypointKey: string
    title: string
  }) => Promise<AiRuntimeOptions | null>
}

export function useQuizGenerationWorkspace({ palaceId, palace, selectedChapterId, promptForAiOptions }: Options) {
  const [jobs, setJobs] = useState<QuizGenerationJob[]>([])
  const [job, setJob] = useState<QuizGenerationJob | null>(null)
  const [pdfAssets, setPdfAssets] = useState<QuizPdfAsset[]>([])
  const [loading, setLoading] = useState(false)
  const statusRank = (status: QuizGenerationJob['status']) => ({ draft: 0, extracting: 1, matching_review: 2, generating: 3, preview: 4, saved: 5, failed: 1 }[status])

  const refresh = useCallback(async () => {
    const [jobResponse, pdfResponse] = await Promise.all([
      listQuizGenerationJobsApi(palaceId), listQuizPdfAssetsApi(),
    ])
    setJobs(jobResponse.items)
    setPdfAssets(pdfResponse.items)
    setJob((current) => {
      if (!current) return jobResponse.items.find((item) => item.status !== 'saved') || null
      const found = jobResponse.items.find((item) => item.id === current.id)
      if (!found) return current
      return statusRank(found.status) < statusRank(current.status) ? current : found
    })
  }, [palaceId])

  useEffect(() => { void refresh().catch((error) => toast.error(error instanceof Error ? error.message : '加载生成工作台失败。')) }, [refresh])
  useEffect(() => {
    if (!job || job.selected_chapter_id === selectedChapterId) return
    void updateQuizGenerationJobApi(job.id, { selected_chapter_id: selectedChapterId })
      .then((response) => setJob(response.item))
      .catch((error) => toast.error(error instanceof Error ? error.message : '更新题库范围失败。'))
  }, [job, selectedChapterId])

  const run = useCallback(async <T,>(action: () => Promise<T>, message?: string) => {
    setLoading(true)
    try { const result = await action(); if (message) toast.success(message); return result }
    catch (error) { toast.error(error instanceof Error ? error.message : '操作失败。'); throw error }
    finally { setLoading(false) }
  }, [])

  const ensureJob = useCallback(async () => {
    if (job) return job
    const response = await createQuizGenerationJobApi(palaceId, {
      title: `${palace?.title || '宫殿'}题库生成`, selected_chapter_id: selectedChapterId,
    })
    setJob(response.item); setJobs((current) => [response.item, ...current]); return response.item
  }, [job, palace?.title, palaceId, selectedChapterId])

  const addText = async (role: QuizSourceRole, text: string) => {
    const target = await ensureJob()
    await run(() => addQuizTextSourceApi(target.id, { role, source_type: 'text', text_content: text, display_name: role === 'question' ? '题目文本' : '答案文本' }))
    await refresh()
  }
  const addMindmap = async () => {
    const target = await ensureJob()
    await run(() => addQuizTextSourceApi(target.id, {
      role: 'question', source_type: 'review_mindmap', display_name: '当前复习脑图',
      config: { review_editor_doc: palace?.editor_doc ?? null, palace_id: palaceId },
    }))
    await refresh()
  }
  const addFiles = async (role: QuizSourceRole, files: File[]) => {
    const target = await ensureJob()
    await run(async () => { for (const file of files) await addQuizFileSourceApi(target.id, role, file) })
    await refresh()
  }
  const addPdf = async (role: QuizSourceRole, assetId: number, expression: string) => {
    const target = await ensureJob()
    await run(() => addQuizPdfSourceApi(target.id, { role, pdf_asset_id: assetId, page_expression: expression }))
    await refresh()
  }
  const uploadPdf = async (file: File) => { await run(() => uploadQuizPdfAssetApi(file), 'PDF 已加入长期资料库。'); await refresh() }
  const removeSource = async (sourceId: number) => { if (!job) return; await run(() => deleteQuizSourceApi(job.id, sourceId)); await refresh() }
  const moveSource = async (sourceId: number, direction: -1 | 1) => {
    if (!job) return
    const ordered = [...job.sources].sort((a, b) => a.sort_order - b.sort_order)
    const index = ordered.findIndex((item) => item.id === sourceId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    const response = await run(() => reorderQuizSourcesApi(job.id, ordered.map((item) => item.id)))
    setJob(response.item); await refresh()
  }
  const extractMatch = async () => {
    const target = await ensureJob()
    const aiOptions = await promptForAiOptions({ scenarioKey: 'quiz_text_generation', entrypointKey: 'quiz-workspace-extract-match', title: '题库解析与匹配配置' })
    if (!aiOptions) return
    const response = await run(() => extractMatchQuizJobApi(target.id, aiOptions), '题目与答案已解析，请确认匹配结果。')
    setJob(response.item)
    setJobs((current) => [response.item, ...current.filter((item) => item.id !== response.item.id)])
  }
  const saveMatching = async (items: QuizMatchingItem[]) => {
    if (!job) return
    const response = await run(() => updateQuizMatchingApi(job.id, items))
    setJob(response.item)
    setJobs((current) => [response.item, ...current.filter((item) => item.id !== response.item.id)])
  }
  const generatePreview = async () => {
    if (!job) return
    const response = await run(() => generateQuizWorkspacePreviewApi(job.id), '题库预览已生成。')
    setJob(response.item)
    setJobs((current) => [response.item, ...current.filter((item) => item.id !== response.item.id)])
  }
  const rematch = async (itemIds: string[]) => {
    if (!job || itemIds.length === 0) return
    const response = await run(() => rematchQuizItemsApi(job.id, itemIds), '已重新匹配选中条目。')
    setJob(response.item)
  }
  const markSaved = async () => { if (!job) return; await markQuizGenerationJobSavedApi(job.id); await refresh() }
  const createNew = async () => {
    const response = await createQuizGenerationJobApi(palaceId, {
      title: `${palace?.title || '宫殿'}题库生成`, selected_chapter_id: selectedChapterId,
    })
    setJob(response.item)
    setJobs((current) => [response.item, ...current])
  }
  const removeJob = async (jobId: string) => { await run(() => deleteQuizGenerationJobApi(jobId)); if (job?.id === jobId) setJob(null); await refresh() }
  const updateConfig = async (data: { extra_prompt?: string; options?: Record<string, unknown> }) => {
    const target = await ensureJob()
    const response = await run(() => updateQuizGenerationJobApi(target.id, data))
    setJob(response.item)
  }
  const archivePdf = async (assetId: number) => { await run(() => updateQuizPdfAssetApi(assetId, { archived: true }), 'PDF 已归档。'); await refresh() }
  const deletePdf = async (assetId: number) => { await run(() => deleteQuizPdfAssetApi(assetId), 'PDF 已删除。'); await refresh() }

  return { jobs, job, setJob, pdfAssets, loading, addText, addMindmap, addFiles, addPdf, uploadPdf, removeSource, moveSource, extractMatch, saveMatching, rematch, generatePreview, markSaved, createNew, removeJob, updateConfig, archivePdf, deletePdf }
}
