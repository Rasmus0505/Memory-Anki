import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import type {
  PalaceQuizMutationPromptResult,
  PalaceQuizQuestion,
  PalaceQuizVariantImportItem,
  PalaceQuizVariantImportResult,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Textarea } from '@/shared/components/ui/textarea'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

import {
  buildPalaceQuizMutationPromptApi,
  importPalaceQuizQuestionVariantsApi,
} from '../api'

const IMPORT_PLACEHOLDER = `[
  {
    "question_id": 1024,
    "base_version_id": "original",
    "question_type": "multiple_choice",
    "stem": "【AI变体】新题干",
    "options": [
      {"id": "A", "text": "选项内容"},
      {"id": "B", "text": "选项内容"},
      {"id": "C", "text": "选项内容"},
      {"id": "D", "text": "选项内容"}
    ],
    "answer_payload": {"correct_option_id": "A"},
    "analysis": "先说明正确依据，再按 A/B/C/D 逐一说明干扰项错在哪里。"
  }
]`

function parseImportItems(text: string): PalaceQuizVariantImportItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(
      error instanceof Error ? `JSON 解析失败：${error.message}` : 'JSON 解析失败。',
      { cause: error },
    )
  }
  if (!Array.isArray(parsed)) throw new Error('顶层必须是 JSON 数组。')
  return parsed as PalaceQuizVariantImportItem[]
}

function ImportPreview({
  preview,
}: {
  preview: PalaceQuizVariantImportResult | null
}) {
  if (preview == null) return null
  return (
    <div className="space-y-2">
      {preview.results.map((row, index) => {
        const ok = row.status === 'imported'
        return (
          <div
            key={`${row.question_id ?? 'unknown'}-${index}`}
            className={cn(
              'flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
              ok
                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/20'
                : 'border-rose-200 bg-rose-50/60 dark:border-rose-800/60 dark:bg-rose-950/20',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                #{index + 1} · 题目 {row.question_id ?? '—'}
              </div>
              {row.stem ? (
                <div className="mt-0.5 truncate text-muted-foreground" title={row.stem}>
                  {row.stem}
                </div>
              ) : null}
            </div>
            <Badge
              variant={ok ? 'secondary' : 'destructive'}
              className="shrink-0 text-[10px]"
            >
              {ok ? '✅ 可导入' : `⚠️ ${row.reason || '跳过'}`}
            </Badge>
          </div>
        )
      })}
      <p className="text-xs text-muted-foreground">
        校验结果：<span className="font-medium text-emerald-700 dark:text-emerald-300">{preview.imported_count}</span> 道可导入，
        {preview.skipped_count} 道将跳过。
      </p>
    </div>
  )
}

export function QuizMutationBatchBar({
  questions,
  onImported,
  className,
}: {
  questions: PalaceQuizQuestion[]
  onImported?: (items: PalaceQuizQuestion[]) => void
  className?: string
}) {
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [promptMeta, setPromptMeta] = useState<PalaceQuizMutationPromptResult | null>(null)
  const [promptLoading, setPromptLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [preview, setPreview] = useState<PalaceQuizVariantImportResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  const markedCount = questions.filter((question) => question.needs_mutation).length

  const openPrompt = async () => {
    if (markedCount === 0) {
      toast.info('当前范围没有待换题。先用「🎯 标记换题」标记几道题。')
      return
    }
    setPromptLoading(true)
    try {
      const result = await buildPalaceQuizMutationPromptApi(
        questions.map((question) => question.id),
      )
      if (result.question_count === 0) {
        toast.info('当前范围没有可复制的待换题。')
        return
      }
      setPromptText(result.text)
      setPromptMeta(result)
      setPromptOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成待换题 Prompt 失败。')
    } finally {
      setPromptLoading(false)
    }
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText)
      toast.success(
        `✅ 已复制 ${promptMeta?.question_count ?? markedCount} 道待换题及完整提示词，请直接粘贴给外部 AI。`,
      )
    } catch {
      toast.error('复制失败，请检查浏览器剪贴板权限。')
    }
  }

  const openImport = () => {
    setImportText('')
    setPreview(null)
    setImportOpen(true)
  }

  const previewImport = async () => {
    setPreviewLoading(true)
    try {
      const items = parseImportItems(importText)
      setPreview(await importPalaceQuizQuestionVariantsApi(items, { dryRun: true }))
    } catch (error) {
      setPreview(null)
      toast.error(error instanceof Error ? error.message : '预览导入内容失败。')
    } finally {
      setPreviewLoading(false)
    }
  }

  const confirmImport = async () => {
    if (preview == null || preview.imported_count === 0) return
    setImporting(true)
    try {
      const items = parseImportItems(importText)
      const result = await importPalaceQuizQuestionVariantsApi(items)
      if (result.items.length > 0) onImported?.(result.items)
      if (result.imported_count > 0) {
        toast.success(
          `🎉 成功替换 ${result.imported_count} 道题目！原真题已安全归档至历史版本，可随时一键恢复。`,
        )
      }
      if (result.skipped_count > 0) {
        toast.warning(`${result.skipped_count} 道题目被跳过，请检查导入 JSON。`)
      }
      setImportOpen(false)
      setPreview(null)
      setImportText('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入 AI 替换题失败。')
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-8 gap-1 text-xs"
          loading={promptLoading}
          loadingText="生成中"
          disabled={markedCount === 0}
          onClick={() => void openPrompt()}
        >
          📋 一键复制待换题 + Prompt ({markedCount}道)
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          disabled={questions.length === 0}
          onClick={openImport}
        >
          📥 导入 AI 替换题 JSON
        </Button>
      </div>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>待换题 Prompt 预览</DialogTitle>
            <DialogDescription>
              已按当前范围筛选「待换题」，并拼接每道题绑定的导图节点、路径、备注与子节点上下文。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            value={promptText}
            className="max-h-[60vh] min-h-[360px] resize-y font-mono text-[11px] leading-relaxed"
          />
          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              共 {promptMeta?.question_count ?? 0} 道待换题
              {promptMeta && promptMeta.skipped_count > 0
                ? ` · ${promptMeta.skipped_count} 道未标记已跳过`
                : ''}
            </span>
            <Button type="button" variant="outline" onClick={() => setPromptOpen(false)}>
              关闭
            </Button>
            <Button type="button" onClick={() => void copyPrompt()}>
              复制到剪贴板
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>导入 AI 替换题 JSON</DialogTitle>
            <DialogDescription>
              先解析预览；格式错误、题目不存在或版本已变化的条目会跳过，其余正常入库。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value)
              setPreview(null)
            }}
            placeholder={IMPORT_PLACEHOLDER}
            spellCheck={false}
            className="max-h-[40vh] min-h-[200px] resize-y font-mono text-[11px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={previewLoading}
              loadingText="校验中"
              disabled={!importText.trim()}
              onClick={() => void previewImport()}
            >
              解析预览
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!importText}
              onClick={() => {
                setImportText('')
                setPreview(null)
              }}
            >
              清空
            </Button>
          </div>
          <ImportPreview preview={preview} />
          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              导入后会自动切换到最新变体，并清除「待换题」标记。
            </span>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              loading={importing}
              loadingText="入库中"
              disabled={preview == null || preview.imported_count === 0}
              onClick={() => void confirmImport()}
            >
              确认替换并入库 ({preview?.imported_count ?? 0} 道)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * 换题工作流 row for the answering dialogs.
 *
 * On phones the two AI buttons are an occasional detour, but as a permanent row
 * they cost the question body ~130px — the difference between reading a stem and
 * its options together or scrolling for the options. Below `sm` they fold behind
 * a one-line disclosure; from `sm` up the row renders exactly as before.
 */
export function QuizMutationWorkflowStrip({
  questions,
  onImported,
}: {
  questions: PalaceQuizQuestion[]
  onImported?: (items: PalaceQuizQuestion[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="shrink-0 border-b border-border/60">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-1.5 text-[11px] text-muted-foreground sm:hidden"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>换题工作流</span>
        <ChevronDown
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      <div className={cn('flex flex-wrap items-center gap-2 px-4 pb-2', !open && 'hidden sm:flex')}>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">换题工作流</span>
        <QuizMutationBatchBar questions={questions} onImported={onImported} />
      </div>
    </div>
  )
}
