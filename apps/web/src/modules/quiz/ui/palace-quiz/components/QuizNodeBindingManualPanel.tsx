import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import {
  getPalaceQuizQuestionsApi,
  listPalaceQuizNodeBindingsApi,
  mutatePalaceQuizNodeBindingsApi,
  searchQuizMindmapNodesApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import type { QuizMindmapNodeSearchHit } from '@/shared/api/contracts'
import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
} from '@/modules/content/public'
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
  const [addTargetPalaceId, setAddTargetPalaceId] = useState<number | null>(palaceId)
  const [addReason, setAddReason] = useState('手动绑定')
  const [nodeSearch, setNodeSearch] = useState('')
  const [nodeHits, setNodeHits] = useState<QuizMindmapNodeSearchHit[]>([])
  const [searchingNodes, setSearchingNodes] = useState(false)

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

  const handleSearchNodes = async () => {
    const q = nodeSearch.trim()
    if (!q) {
      toast.message('输入宫殿名或节点文案关键词。')
      return
    }
    setSearchingNodes(true)
    try {
      const response = await searchQuizMindmapNodesApi(q, { limit: 40 })
      setNodeHits(response.items)
      if (response.items.length === 0) toast.message('没有匹配的节点。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索节点失败。')
    } finally {
      setSearchingNodes(false)
    }
  }

  const handleRemove = async (edge: QuizNodeBindingEdge) => {
    setSaving(true)
    try {
      const target = edge.target_palace_id ?? edge.palace_id ?? palaceId
      const result = await mutatePalaceQuizNodeBindingsApi(palaceId, {
        remove: [
          {
            question_id: edge.question_id,
            node_uid: edge.node_uid,
            target_palace_id: target,
          },
        ],
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
    const targetPalaceId = addTargetPalaceId ?? palaceId
    if (!Number.isFinite(questionId) || questionId <= 0 || !nodeUid) {
      toast.message('请选择题目和知识点卡片。')
      return
    }
    setSaving(true)
    try {
      const result = await mutatePalaceQuizNodeBindingsApi(palaceId, {
        add: [
          {
            question_id: questionId,
            node_uid: nodeUid,
            target_palace_id: targetPalaceId,
            reason: addReason.trim() || '手动绑定',
          },
        ],
      })
      setBindings(result.items)
      onChanged?.(result.items)
      toast.success(
        targetPalaceId === palaceId ? '已添加手动绑定' : '已添加跨宫手动绑定',
      )
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
        手改绑定：可绑本宫节点，也可全局搜索他宫节点。边的目标宫殿可以与题目归属不同；AI
        全量替换只清本宫 AI 边，手动边保留。
      </p>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-sm font-medium">新增绑定</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">题目（本宫题库）</span>
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
            <span className="text-muted-foreground">本宫节点（快捷）</span>
            <select
              className="min-h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={addTargetPalaceId === palaceId ? addNodeUid : ''}
              onChange={(event) => {
                setAddNodeUid(event.target.value)
                setAddTargetPalaceId(palaceId)
              }}
            >
              <option value="">选择本宫节点…</option>
              {nodes.map((node) => (
                <option key={node.uid} value={node.uid}>
                  {'·'.repeat(Math.min(node.depth, 4))} {node.text.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-2 rounded-md border border-dashed p-2">
          <div className="text-xs font-medium text-muted-foreground">全局搜索节点（可跨宫）</div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={nodeSearch}
              onChange={(event) => setNodeSearch(event.target.value)}
              placeholder="搜节点文案 / uid…"
              className="h-9 min-w-[12rem] flex-1"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={searchingNodes}
              onClick={() => void handleSearchNodes()}
            >
              {searchingNodes ? '搜索中…' : '搜索'}
            </Button>
          </div>
          {nodeHits.length > 0 ? (
            <select
              className="min-h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={
                addNodeUid && addTargetPalaceId != null
                  ? `${addTargetPalaceId}::${addNodeUid}`
                  : ''
              }
              onChange={(event) => {
                const [rawPalace, ...rest] = event.target.value.split('::')
                const target = Number(rawPalace)
                const uid = rest.join('::')
                if (Number.isFinite(target) && uid) {
                  setAddTargetPalaceId(target)
                  setAddNodeUid(uid)
                }
              }}
            >
              <option value="">从搜索结果选择…</option>
              {nodeHits.map((hit) => (
                <option key={`${hit.palace_id}:${hit.node_uid}`} value={`${hit.palace_id}::${hit.node_uid}`}>
                  [{hit.palace_title}] {hit.node_text.slice(0, 48)}
                </option>
              ))}
            </select>
          ) : null}
          {addNodeUid ? (
            <div className="text-xs text-muted-foreground">
              当前选中：宫 {addTargetPalaceId ?? palaceId} · {addNodeUid}
            </div>
          ) : null}
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
