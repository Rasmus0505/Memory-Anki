import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import {
  getPalaceQuizQuestionsApi,
  listPalaceQuizNodeBindingsApi,
  mutatePalaceQuizNodeBindingsApi,
} from '@/entities/quiz/api'
import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
} from '@/entities/mindmap-document'
import type { MindMapDocNode, PalaceQuizQuestion, QuizNodeBindingEdge } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { toast } from '@/shared/feedback/toast'

function flattenNodes(
  editorDoc: MindMapDocumentInput,
): Array<{ uid: string; text: string; depth: number }> {
  const doc = normalizeMindMapDocument(editorDoc)
  const rows: Array<{ uid: string; text: string; depth: number }> = []
  const walk = (node: MindMapDocNode, indexPath: number[], depth: number) => {
    const uid = getMindMapNodeUid(node, indexPath.join('-') || 'root')
    const text = String(node.data?.text || uid).trim() || uid
    if (uid) rows.push({ uid, text, depth })
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, index) => walk(child, [...indexPath, index], depth + 1))
  }
  walk(doc.root as MindMapDocNode, [], 0)
  return rows
}

export function QuizNodeBindingManualPanel({
  palaceId,
  editorDoc,
  onChanged,
}: {
  palaceId: number
  editorDoc: MindMapDocumentInput
  onChanged?: (items: QuizNodeBindingEdge[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bindings, setBindings] = useState<QuizNodeBindingEdge[]>([])
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [filter, setFilter] = useState('')
  const [addQuestionId, setAddQuestionId] = useState<string>('')
  const [addNodeUid, setAddNodeUid] = useState<string>('')
  const [addReason, setAddReason] = useState('手动绑定')

  const nodes = useMemo(() => flattenNodes(editorDoc), [editorDoc])
  const nodeLabelByUid = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of nodes) map.set(node.uid, node.text)
    return map
  }, [nodes])
  const questionById = useMemo(() => {
    const map = new Map<number, PalaceQuizQuestion>()
    for (const question of questions) map.set(question.id, question)
    return map
  }, [questions])

  const refresh = async () => {
    setLoading(true)
    try {
      const [bindingResponse, questionResponse] = await Promise.all([
        listPalaceQuizNodeBindingsApi(palaceId),
        getPalaceQuizQuestionsApi(palaceId),
      ])
      setBindings(bindingResponse.items)
      setQuestions(questionResponse.items)
      onChanged?.(bindingResponse.items)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载绑定失败。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per palace
  }, [palaceId])

  const filteredBindings = useMemo(() => {
    const keyword = filter.trim().toLowerCase()
    if (!keyword) return bindings
    return bindings.filter((edge) => {
      const question = questionById.get(edge.question_id)
      const stem = String(question?.stem || '').toLowerCase()
      const nodeText = String(nodeLabelByUid.get(edge.node_uid) || edge.node_uid).toLowerCase()
      return (
        stem.includes(keyword) ||
        nodeText.includes(keyword) ||
        String(edge.question_id).includes(keyword) ||
        edge.node_uid.toLowerCase().includes(keyword)
      )
    })
  }, [bindings, filter, nodeLabelByUid, questionById])

  const handleRemove = async (edge: QuizNodeBindingEdge) => {
    setSaving(true)
    try {
      const result = await mutatePalaceQuizNodeBindingsApi(palaceId, {
        remove: [{ question_id: edge.question_id, node_uid: edge.node_uid }],
      })
      setBindings(result.items)
      onChanged?.(result.items)
      toast.success('已删除绑定')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除绑定失败。')
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async () => {
    const questionId = Number(addQuestionId)
    const nodeUid = addNodeUid.trim()
    if (!Number.isFinite(questionId) || questionId <= 0 || !nodeUid) {
      toast.message('请选择题目和知识点卡片。')
      return
    }
    setSaving(true)
    try {
      const result = await mutatePalaceQuizNodeBindingsApi(palaceId, {
        add: [{ question_id: questionId, node_uid: nodeUid, reason: addReason.trim() || '手动绑定' }],
      })
      setBindings(result.items)
      onChanged?.(result.items)
      toast.success('已添加手动绑定')
      setAddReason('手动绑定')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加绑定失败。')
    } finally {
      setSaving(false)
    }
  }

  if (loading && bindings.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        加载绑定关系…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        手改绑定用于纠正 AI 结果：给题目增加/删除知识点卡片关联。写入来源标记为
        <span className="font-medium text-foreground"> manual</span>
        ，AI 全量替换时会保留手动边。
      </p>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-sm font-medium">新增绑定</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">题目</span>
            <select
              className="min-h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={addQuestionId}
              onChange={(event) => setAddQuestionId(event.target.value)}
            >
              <option value="">选择题目…</option>
              {questions.map((question) => (
                <option key={question.id} value={question.id}>
                  Q{question.id} · {(question.stem || '').slice(0, 48)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">知识点卡片</span>
            <select
              className="min-h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={addNodeUid}
              onChange={(event) => setAddNodeUid(event.target.value)}
            >
              <option value="">选择节点…</option>
              {nodes.map((node) => (
                <option key={node.uid} value={node.uid}>
                  {'·'.repeat(Math.min(node.depth, 4))} {node.text.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1 space-y-1 text-xs">
            <span className="text-muted-foreground">备注（可选）</span>
            <Input value={addReason} onChange={(event) => setAddReason(event.target.value)} />
          </label>
          <Button type="button" size="sm" onClick={() => void handleAdd()} disabled={saving}>
            <Plus className="mr-1 size-4" />
            添加
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="筛选题号 / 题干 / 节点…"
          className="h-9"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={loading || saving}>
          刷新
        </Button>
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
        {filteredBindings.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">暂无绑定关系。</div>
        ) : (
          filteredBindings.map((edge) => {
            const stem = questionById.get(edge.question_id)?.stem || ''
            const nodeText = nodeLabelByUid.get(edge.node_uid) || edge.node_uid
            return (
              <div
                key={`${edge.question_id}:${edge.node_uid}`}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <span className="font-mono text-xs">Q{edge.question_id}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="text-xs">{nodeText}</span>
                    <span className="ml-2 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                      {edge.source || 'ai'}
                    </span>
                  </div>
                  {stem ? (
                    <div className="truncate text-xs text-muted-foreground">{stem}</div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 text-destructive"
                  disabled={saving}
                  onClick={() => void handleRemove(edge)}
                  title="删除此绑定"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )
          })
        )}
      </div>
      <div className="text-xs text-muted-foreground">共 {bindings.length} 条绑定</div>
    </div>
  )
}
