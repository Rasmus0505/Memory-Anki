import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import type {
  PalaceQuizGenerationPreview,
  PalaceQuizQuestionType,
} from '@/shared/api/contracts'

const CHAPTER_QUIZ_TYPE_OPTIONS: Array<{ value: PalaceQuizQuestionType; label: string }> = [
  { value: 'multiple_choice', label: '选择题' },
  { value: 'short_answer', label: '简答题' },
  { value: 'true_false', label: '判断题' },
]

interface KnowledgeChapterQuizDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  questionTypes: PalaceQuizQuestionType[]
  onToggleQuestionType: (type: PalaceQuizQuestionType) => void
  questionCount: number
  onQuestionCountChange: (count: number) => void
  classify: boolean
  onClassifyChange: (checked: boolean) => void
  canClassify: boolean
  childChapterCount: number
  extraPrompt: string
  onExtraPromptChange: (value: string) => void
  preview: PalaceQuizGenerationPreview | null
  loading: boolean
  saving: boolean
  onGenerate: () => void
  onSave: () => void
}

export function KnowledgeChapterQuizDialog({
  open,
  onOpenChange,
  questionTypes,
  onToggleQuestionType,
  questionCount,
  onQuestionCountChange,
  classify,
  onClassifyChange,
  canClassify,
  childChapterCount,
  extraPrompt,
  onExtraPromptChange,
  preview,
  loading,
  saving,
  onGenerate,
  onSave,
}: KnowledgeChapterQuizDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>章节 AI 出题</DialogTitle>
          <DialogDescription>
            以当前章节作为“大宫殿”生成题目；勾选“按宫殿分类”时，会按当前章节的直接子章节分类。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-4">
          <div className="space-y-2">
            <div className="text-sm font-semibold">题型</div>
            <div className="flex flex-wrap gap-2">
              {CHAPTER_QUIZ_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={questionTypes.includes(option.value)}
                    onChange={() => onToggleQuestionType(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chapter-quiz-count">数量</Label>
              <Input
                id="chapter-quiz-count"
                type="number"
                min={1}
                max={30}
                value={questionCount}
                onChange={(event) => onQuestionCountChange(Number(event.target.value || 5))}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={classify}
                  disabled={!canClassify}
                  onChange={(event) => onClassifyChange(event.target.checked)}
                />
                <span>按宫殿分类</span>
              </Label>
              <div className="text-xs text-muted-foreground">
                {canClassify
                  ? `将按 ${childChapterCount} 个直接子章节分类。`
                  : '当前章节没有下级小节，无法分类。'}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="chapter-quiz-extra-prompt">额外要求</Label>
            <Textarea
              id="chapter-quiz-extra-prompt"
              value={extraPrompt}
              onChange={(event) => onExtraPromptChange(event.target.value)}
              placeholder="例如：偏重概念辨析；只出本章核心考点。"
            />
          </div>
          {preview ? (
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-3">
              <div className="text-sm font-semibold">生成预览</div>
              <div className="text-xs text-muted-foreground">
                共 {preview.questions.length} 题
                {preview.grouped_questions &&
                'child_chapter_groups' in preview.grouped_questions
                  ? `，其中 ${preview.grouped_questions.child_chapter_groups.length} 组已按子章节分类`
                  : ''}
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {preview.questions.map((question, index) => (
                  <div key={`${question.stem}-${index}`} className="rounded-xl border border-border/70 px-3 py-2">
                    <div className="text-xs text-muted-foreground">第 {index + 1} 题</div>
                    <div className="text-sm">{question.stem}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="outline" onClick={onGenerate} disabled={loading}>
            {loading ? '生成中...' : '生成预览'}
          </Button>
          <Button onClick={onSave} disabled={!preview || saving}>
            {saving ? '保存中...' : '确认保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
