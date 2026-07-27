import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
} from '@/modules/content/public'
import { mutatePalaceQuizNodeBindingsApi } from '@/modules/quiz/domain/quiz-entity/api'
import type {
  MindMapDocNode,
  PalaceQuizQuestion,
  QuizNodeBindingEdge,
} from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { toast } from '@/shared/feedback/toast'

export interface QuizNodeDeleteGuardRequest {
  /** Uids about to disappear from the mindmap. */
  removedNodeUids: readonly string[]
  /** Binding edges landing on those uids. */
  affectedEdges: readonly QuizNodeBindingEdge[]
}

/** Nodes that survive the delete, offered as re-bind targets. */
function survivingNodes(
  editorDoc: MindMapDocumentInput,
  removedNodeUids: readonly string[],
): Array<{ uid: string; text: string; depth: number }> {
  const removed = new Set(removedNodeUids)
  const doc = normalizeMindMapDocument(editorDoc)
  const rows: Array<{ uid: string; text: string; depth: number }> = []
  const walk = (node: MindMapDocNode, indexPath: number[], depth: number) => {
    const uid = getMindMapNodeUid(node, indexPath.join('-') || 'root')
    if (uid && !removed.has(uid)) {
      rows.push({ uid, text: String(node.data?.text || uid).trim() || uid, depth })
    }
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, index) => walk(child, [...indexPath, index], depth + 1))
  }
  walk(doc.root as MindMapDocNode, [], 0)
  return rows
}

/**
 * Shown when deleting cards that still carry quiz bindings. Lists the questions so
 * the user can judge, then either moves each one to a surviving card or drops the
 * binding. Nothing is written until the user picks 确认删除.
 */
export function QuizNodeDeleteGuardDialog({
  request,
  palaceId,
  editorDoc,
  questionById,
  onResolve,
}: {
  request: QuizNodeDeleteGuardRequest | null
  palaceId: number | null
  editorDoc: MindMapDocumentInput
  questionById: ReadonlyMap<number, PalaceQuizQuestion>
  /** true = go ahead and delete the cards, false = abort. */
  onResolve: (proceed: boolean) => void
}) {
  const [saving, setSaving] = useState(false)
  // edge key -> target uid to move to; '' means drop the binding.
  const [targetByEdge, setTargetByEdge] = useState<Record<string, string>>({})

  useEffect(() => {
    setTargetByEdge({})
    setSaving(false)
  }, [request])

  const candidates = useMemo(
    () => (request ? survivingNodes(editorDoc, request.removedNodeUids) : []),
    [editorDoc, request],
  )

  const edges = useMemo(() => request?.affectedEdges ?? [], [request])
  const questionCount = useMemo(
    () => new Set(edges.map((edge) => edge.question_id)).size,
    [edges],
  )

  const handleConfirm = async () => {
    if (!request || !palaceId) return
    const remove = edges.map((edge) => ({
      question_id: edge.question_id,
      node_uid: edge.node_uid,
      target_palace_id: edge.target_palace_id ?? edge.palace_id ?? palaceId,
    }))
    const add = edges
      .map((edge) => {
        const target = targetByEdge[`${edge.question_id}:${edge.node_uid}`]
        if (!target) return null
        return {
          question_id: edge.question_id,
          node_uid: target,
          target_palace_id: palaceId,
          reason: '删除卡片时转移绑定',
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

    setSaving(true)
    try {
      await mutatePalaceQuizNodeBindingsApi(palaceId, { remove, add })
      toast.success(
        add.length
          ? `已转移 ${add.length} 条绑定，解除 ${remove.length - add.length} 条`
          : `已解除 ${remove.length} 条绑定`,
      )
      onResolve(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理绑定失败，已取消删除。')
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(next) => {
        if (!next && !saving) onResolve(false)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>这些卡片上还挂着题目</DialogTitle>
          <DialogDescription>
            即将删除的卡片绑定了 {questionCount} 道题（共 {edges.length} 条绑定）。
            逐条选择转移到哪张卡片；留空表示直接解除该条绑定。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[22rem] space-y-2 overflow-y-auto rounded-md border p-2">
          {edges.map((edge) => {
            const key = `${edge.question_id}:${edge.node_uid}`
            const stem = questionById.get(edge.question_id)?.stem || ''
            return (
              <div key={key} className="space-y-1 rounded-md px-2 py-2 hover:bg-muted/50">
                <div className="text-sm">
                  <span className="font-mono text-xs">Q{edge.question_id}</span>
                  <span className="mx-1 text-muted-foreground">原绑定</span>
                  <span className="text-xs">{edge.node_text || edge.node_uid}</span>
                </div>
                {stem ? (
                  <div className="line-clamp-3 text-xs text-muted-foreground">{stem}</div>
                ) : (
                  <div className="text-xs italic text-muted-foreground">（题干未加载）</div>
                )}
                <select
                  className="min-h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={targetByEdge[key] ?? ''}
                  onChange={(event) =>
                    setTargetByEdge((current) => ({ ...current, [key]: event.target.value }))
                  }
                >
                  <option value="">解除绑定（不转移）</option>
                  {candidates.map((node) => (
                    <option key={node.uid} value={node.uid}>
                      {'·'.repeat(Math.min(node.depth, 4))} {node.text.slice(0, 40)}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onResolve(false)}>
            取消删除
          </Button>
          <Button type="button" variant="destructive" disabled={saving} onClick={() => void handleConfirm()}>
            {saving ? <LoaderCircle className="mr-1 size-4 animate-spin" /> : null}
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
