import { Send, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { requestPalaceQuestionExplainApi } from '@/entities/quiz/api'
import {
  createFreestyleQuestionExplanationApi,
  getFreestyleQuestionExplanationsApi,
} from '@/features/freestyle/api'
import type {
  AiRuntimeOptions,
  FreestyleAiExplanationRecord,
  FreestyleQuizCard,
} from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'

const PRESETS = [
  { label: '解释考点', question: '请解释这道题的核心考点是什么。' },
  { label: '记忆技巧', question: '给我一个记住这道题答案的技巧或口诀。' },
  { label: '为什么选这个', question: '为什么正确答案是这个？其他选项错在哪里？' },
  { label: '延伸思考', question: '这个知识点还能延伸出哪些相关考点？' },
]

export function FreestyleAiExplainSheet({
  open,
  card,
  aiOptions,
  onClose,
}: {
  open: boolean
  card: FreestyleQuizCard | null
  aiOptions?: AiRuntimeOptions
  onClose: () => void
}) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<FreestyleAiExplanationRecord[]>([])

  useEffect(() => {
    if (open) return
    setInput('')
    setLoading(false)
    setResult(null)
    setError(null)
    setHistory([])
  }, [open])

  useEffect(() => {
    if (!open || !card) return
    let active = true
    void getFreestyleQuestionExplanationsApi({ questionId: card.question.id, limit: 5 })
      .then((response) => {
        if (active) setHistory(response.items || [])
      })
      .catch(() => {
        if (active) setHistory([])
      })
    return () => {
      active = false
    }
  }, [card, open])

  async function send(question: string) {
    const trimmedQuestion = question.trim()
    if (!card || !trimmedQuestion || loading) return
    setInput(trimmedQuestion)
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const response = await requestPalaceQuestionExplainApi(
        card.question.id,
        trimmedQuestion,
        aiOptions,
      )
      setResult(response.explanation_text)
      void createFreestyleQuestionExplanationApi({
        question_id: card.question.id,
        palace_id: card.palace_context.id,
        palace_title: card.palace_context.resolved_title || card.palace_context.title || '',
        mini_palace_id: card.mini_palace_context?.id ?? card.question.mini_palace_id ?? null,
        mini_palace_name: card.mini_palace_context?.name || card.question.mini_palace?.name || '',
        chapter_id: card.chapter_context?.id ?? card.question.classified_chapter_id ?? card.question.source_chapter_id ?? null,
        chapter_name: card.chapter_context?.name || '',
        question_type: card.question.question_type,
        stem_snapshot: card.question.stem,
        user_question: trimmedQuestion,
        explanation_text: response.explanation_text,
        ai_call_log_id: response.ai_call_log_id,
      })
        .then((saved) => {
          setHistory((current) => [saved.item, ...current.filter((item) => item.id !== saved.item.id)].slice(0, 5))
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : 'AI 讲解历史保存失败。')
        })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 讲解请求失败')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
        aria-label="关闭 AI 讲解"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[82dvh] flex-col rounded-t-2xl border-t border-white/10 bg-zinc-950 text-zinc-100 shadow-2xl">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-zinc-700" />
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-amber-400" />
            <span className="truncate text-sm font-semibold">AI 讲解</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto px-5 pb-3 [scrollbar-width:none]">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={loading || !card}
              onClick={() => void send(preset.question)}
              className="shrink-0 rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition-all hover:bg-zinc-800 hover:text-zinc-50 active:scale-95 disabled:opacity-40"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 border-t border-white/10 px-4 py-3">
          <textarea
            rows={2}
            className="min-h-[52px] flex-1 resize-none rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
            placeholder="或者直接输入你的问题..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button
            type="button"
            size="icon"
            disabled={loading || !card || !input.trim()}
            onClick={() => void send(input)}
            className="size-11 shrink-0 rounded-xl bg-amber-400 text-zinc-950 hover:bg-amber-300"
            aria-label="发送 AI 讲解问题"
          >
            <Send className="size-4" />
          </Button>
        </div>
        {(loading || result || error) && (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/10 px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                AI 正在思考...
              </div>
            ) : null}
            {result ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{result}</p>
            ) : null}
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </div>
        )}
        {history.length > 0 ? (
          <div className="max-h-40 overflow-y-auto border-t border-white/10 px-5 py-3">
            <div className="mb-2 text-xs font-medium text-zinc-500">本题最近讲解</div>
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="truncate text-xs text-zinc-400">{item.user_question}</div>
                  <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
                    {item.explanation_text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="h-[env(safe-area-inset-bottom,0px)] shrink-0" />
      </div>
    </div>
  )
}
