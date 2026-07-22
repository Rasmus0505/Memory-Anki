import { useEffect, useState } from 'react'
import { getPalacesGroupedApi } from '@/entities/palace/api'
import { flattenPalaceOptions } from '@/features/freestyle/model/freestyle-cards'
import { sanitizeFreestyleFeedConfig } from '@/modules/freestyle/public'
import type { FreestyleFeedConfig, FreestylePalaceContext } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'

export function FreestyleFeedSettingsDialog({
  open,
  config,
  onOpenChange,
  onSave,
}: {
  open: boolean
  config: FreestyleFeedConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: FreestyleFeedConfig) => void
}) {
  const [draft, setDraft] = useState(config)
  const [palaces, setPalaces] = useState<FreestylePalaceContext[]>([])

  useEffect(() => {
    if (open) setDraft(config)
  }, [config, open])

  useEffect(() => {
    if (!open) return
    let active = true
    void getPalacesGroupedApi()
      .then((data) => {
        if (active) setPalaces(flattenPalaceOptions(data))
      })
      .catch(() => {
        if (active) setPalaces([])
      })
    return () => {
      active = false
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>随心队列设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <Label>导图翻卡</Label>
            <Switch
              checked={draft.content.mindmap_branch}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  content: { ...current.content, mindmap_branch: checked },
                }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>题库刷题</Label>
            <Switch
              checked={draft.content.quiz_question}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  content: { ...current.content, quiz_question: checked },
                }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>弱项题优先</Label>
            <Switch
              checked={draft.weak_quiz_priority}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, weak_quiz_priority: checked }))
              }
            />
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">题型筛选</span>
            <select
              className="w-full rounded-md border bg-background px-3 py-2"
              value={draft.question_type}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  question_type: event.target.value as FreestyleFeedConfig['question_type'],
                }))
              }
            >
              <option value="all">全部题型</option>
              <option value="multiple_choice">选择题</option>
              <option value="true_false">判断题</option>
              <option value="fill_blank">填空题</option>
              <option value="matching">匹配题</option>
              <option value="ordering">排序题</option>
              <option value="categorization">分类题</option>
              <option value="short_answer">简答题</option>
            </select>
          </label>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">指定宫殿（不选表示全部）</div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {palaces.length ? palaces.map((palace) => {
                const checked = draft.specific_palace_ids.includes(palace.id)
                return (
                  <label key={palace.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          specific_palace_ids: checked
                            ? current.specific_palace_ids.filter((id) => id !== palace.id)
                            : [...current.specific_palace_ids, palace.id],
                        }))
                      }
                    />
                    <span className="truncate">{palace.resolved_title || palace.title}</span>
                  </label>
                )
              }) : <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无宫殿</div>}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">导图:题目 权重</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                max={20}
                className="w-full rounded-md border bg-background px-3 py-2"
                value={draft.weights.mindmap_branch}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    weights: {
                      ...current.weights,
                      mindmap_branch: Number(event.target.value),
                    },
                  }))
                }
              />
              <input
                type="number"
                min={0}
                max={20}
                className="w-full rounded-md border bg-background px-3 py-2"
                value={draft.weights.quiz_question}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    weights: {
                      ...current.weights,
                      quiz_question: Number(event.target.value),
                    },
                  }))
                }
              />
            </div>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">宫殿间顺序</span>
            <select
              className="w-full rounded-md border bg-background px-3 py-2"
              value={draft.palace_order}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  palace_order: event.target.value as FreestyleFeedConfig['palace_order'],
                }))
              }
            >
              <option value="finish_palace_then_next">刷完当前宫殿再下一个</option>
              <option value="interleave_palaces">宫殿穿插</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">宫殿内顺序</span>
            <select
              className="w-full rounded-md border bg-background px-3 py-2"
              value={draft.within_palace_order}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  within_palace_order: event.target
                    .value as FreestyleFeedConfig['within_palace_order'],
                }))
              }
            >
              <option value="tree_order">树序（深度优先）</option>
              <option value="deterministic_shuffle">确定性乱序</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">到期策略</span>
            <select
              className="w-full rounded-md border bg-background px-3 py-2"
              value={draft.due_policy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  due_policy: event.target.value as FreestyleFeedConfig['due_policy'],
                }))
              }
            >
              <option value="due_first_then_expand">到期优先再扩展</option>
              <option value="due_only">仅到期</option>
              <option value="all_content_due_weighted">全部内容、到期加权</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">每支目标节点数（完整子树，可略超）</span>
            <input
              type="number"
              min={3}
              max={50}
              className="w-full rounded-md border bg-background px-3 py-2"
              value={draft.node_limit}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  node_limit: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">单轮队列长度</span>
            <input
              type="number"
              min={5}
              max={100}
              className="w-full rounded-md border bg-background px-3 py-2"
              value={draft.queue_length}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  queue_length: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">随机种子</span>
            <input
              type="number"
              min={1}
              className="w-full rounded-md border bg-background px-3 py-2"
              value={draft.seed}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  seed: Number(event.target.value),
                }))
              }
            />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave(sanitizeFreestyleFeedConfig(draft))
              onOpenChange(false)
            }}
          >
            保存并重建剩余队列
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
