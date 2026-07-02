import {
  Brain,
  CheckCircle2,
  Clock3,
  FileText,
  ImagePlus,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import type {
  MiniPalaceSummary,
  PalaceQuizGenerationPreview,
  PalaceQuizPdfSourceMeta,
  SubjectDocumentSummary,
} from '@/shared/api/contracts'
import { PreviewQuestionCard } from '@/features/palace-quiz/components/palaceQuizCards'
import type { QuizGenerationHistoryItem } from '@/features/palace-quiz/quiz-generation-history'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'
import type { QuizGenerationPdfSourceDraft } from '@/features/palace-quiz/quizGenerationController'

const MANUAL_TEXT_FORMAT_PROMPT = `请把我提供的题目资料整理成 Memory Anki 可识别的唯一 JSON，不要输出 markdown 或解释。
顶层格式必须是 {"questions":[...]}。
支持题型：
1. multiple_choice：字段 question_type、stem、options、correct_option_id、analysis；options 为 [{"id":"A","text":"选项A"}]，correct_option_id 必须是某个选项 id。
2. short_answer：字段 question_type、stem、reference_answer、analysis。
3. true_false：字段 question_type、stem、correct_answer、false_explanation、analysis，correct_answer 是 true/false。
4. fill_blank：stem 使用 {{blank_1}} 占位，blanks 为 [{"id":"blank_1","answer":"答案","aliases":[]}]。
5. matching：pairs 为 [{"left_id":"L1","left":"左侧","right_id":"R1","right":"右侧"}]。
6. ordering：items 为 [{"id":"I1","text":"条目"}]，correct_order_ids 覆盖全部 item id。
7. categorization：categories 为 [{"id":"C1","name":"类别"}]，items 为 [{"id":"I1","text":"条目","category_id":"C1"}]。
请保留原题题干、选项、答案和解析，不要编造资料外内容。`

type GenerationSourceKind = 'subject-pdf' | 'image-single' | 'image-batch' | 'text-files'

export function PalaceQuizGenerationPanel({
  hasMiniPalaces,
  rootQuestionCount,
  miniPalaces,
  classificationLoading,
  classificationResult,
  generationSourceKind,
  setGenerationSourceKind,
  generationFiles,
  generationPdfSources,
  generationEnableSecondaryReview,
  setGenerationEnableSecondaryReview,
  generationSaveMode,
  setGenerationSaveMode,
  generationClassifyByMiniPalace,
  setGenerationClassifyByMiniPalace,
  generationError,
  generationLoading,
  generationSaving,
  generationPreview,
  generationHistory,
  historyRegeneratingId,
  generationStreamStatus,
  generationStreamStepLabel,
  generationStreamPreviewText,
  selectedChapterSummary,
  selectedChapterHasChildren,
  subjectsLoading,
  subjectOptions,
  pdfController,
  subjectPdfUploadInputRef,
  generationStreamContentRef,
  getGenerationPreviewSaveCount,
  formatResolvedAiSteps,
  onOpenRangeDialog,
  onGeneratePreview,
  onGenerationStreamScroll,
  onImageFileChange,
  onUploadSubjectPdf,
  onAddCurrentPdfSource,
  onRemovePdfSource,
  onPdfSourceRoleHintChange,
  onSaveGenerationPreview,
  onRegenerateFromHistory,
  onDeleteGenerationHistory,
  onApplyHistoryConfig,
  onClassifyExistingQuestions,
}: {
  hasMiniPalaces: boolean
  rootQuestionCount: number
  miniPalaces: MiniPalaceSummary[]
  classificationLoading: boolean
  classificationResult: any
  generationSourceKind: GenerationSourceKind
  setGenerationSourceKind: (value: GenerationSourceKind) => void
  generationFiles: File[]
  generationPdfSources: QuizGenerationPdfSourceDraft[]
  generationEnableSecondaryReview: boolean
  setGenerationEnableSecondaryReview: (value: boolean) => void
  generationSaveMode: 'append' | 'overwrite'
  setGenerationSaveMode: (value: 'append' | 'overwrite') => void
  generationClassifyByMiniPalace: boolean
  setGenerationClassifyByMiniPalace: (value: boolean) => void
  generationError: string
  generationLoading: boolean
  generationSaving: boolean
  generationPreview: PalaceQuizGenerationPreview | null
  generationHistory: QuizGenerationHistoryItem[]
  historyRegeneratingId: string | null
  generationStreamStatus: string
  generationStreamStepLabel: string
  generationStreamPreviewText: string
  selectedChapterSummary: string
  selectedChapterHasChildren: boolean
  subjectsLoading: boolean
  subjectOptions: Array<{ id: number; name: string }>
  pdfController: any
  subjectPdfUploadInputRef: React.RefObject<HTMLInputElement | null>
  generationStreamContentRef: React.RefObject<HTMLPreElement | null>
  getGenerationPreviewSaveCount: (preview: PalaceQuizGenerationPreview) => number
  formatResolvedAiSteps: (
    steps:
      | Array<{
          scenario_key: string
          model_label?: string | null
        }>
      | {
          generation?: { model_label?: string | null } | null
          pairing?: { model_label?: string | null } | null
          review?: { model_label?: string | null } | null
        }
      | null
      | undefined,
  ) => string
  onOpenRangeDialog: () => Promise<void>
  onGeneratePreview: () => Promise<void>
  onGenerationStreamScroll: () => void
  onImageFileChange: (files: FileList | null) => void
  onUploadSubjectPdf: (file: File) => Promise<void>
  onAddCurrentPdfSource: () => void
  onRemovePdfSource: (subjectDocumentId: number) => void
  onPdfSourceRoleHintChange: (subjectDocumentId: number, value: 'question' | 'answer') => void
  onSaveGenerationPreview: () => Promise<void>
  onRegenerateFromHistory: (item: QuizGenerationHistoryItem) => Promise<void>
  onDeleteGenerationHistory: (historyId: string) => void
  onApplyHistoryConfig: (item: QuizGenerationHistoryItem) => void
  onClassifyExistingQuestions: () => Promise<void>
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_420px]">
      <div className="space-y-4">
        {hasMiniPalaces && rootQuestionCount > 0 ? (
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">已有题库归类到小宫殿</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                当前有 {rootQuestionCount} 道大宫殿题、{miniPalaces.length} 个小宫殿。这里会调用“小宫殿归类”场景会判断哪些题同时属于哪些小宫殿，并复制写入对应小宫殿题库。
              </div>
              {classificationResult ? (
                <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm">
                  <div>本次写入 {classificationResult.copied_question_count} 道小宫殿题。</div>
                  {classificationResult.resolved_ai?.model_label ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      实际模型：{classificationResult.resolved_ai.model_label}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {classificationResult.mini_palace_groups.map((group: any) => (
                      <Badge key={group.mini_palace_id} variant="outline">
                        {group.mini_palace_name}：{group.question_count}
                      </Badge>
                    ))}
                    <Badge variant="secondary">未归类 {classificationResult.unassigned_count}</Badge>
                    {classificationResult.ai_call_log_id ? (
                      <Badge variant="outline">AI日志 {classificationResult.ai_call_log_id}</Badge>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <Button type="button" disabled={classificationLoading} onClick={() => void onClassifyExistingQuestions()}>
                {classificationLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                归类已有题库
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-border/70 bg-card/92">
          <CardHeader>
            <CardTitle className="text-base">来源设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-background/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">题目所属章节范围</div>
                  <div className="text-sm text-muted-foreground">{selectedChapterSummary}</div>
                </div>
                <Button type="button" variant="outline" onClick={() => void onOpenRangeDialog()}>
                  选择范围
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={generationSourceKind === 'subject-pdf' ? 'default' : 'outline'}
                onClick={() => setGenerationSourceKind('subject-pdf')}
              >
                <FileText className="size-4" />
                学科 PDF
              </Button>
              <Button
                type="button"
                variant={generationSourceKind === 'image-single' ? 'default' : 'outline'}
                onClick={() => setGenerationSourceKind('image-single')}
              >
                <ImagePlus className="size-4" />
                单图
              </Button>
              <Button
                type="button"
                variant={generationSourceKind === 'image-batch' ? 'default' : 'outline'}
                onClick={() => setGenerationSourceKind('image-batch')}
              >
                <Sparkles className="size-4" />
                多图
              </Button>
              <Button
                type="button"
                variant={generationSourceKind === 'text-files' ? 'default' : 'outline'}
                onClick={() => setGenerationSourceKind('text-files')}
              >
                <FileText className="size-4" />
                文本/手动导入
              </Button>
            </div>

            {generationSourceKind === 'subject-pdf' ? (
              <div className="space-y-4 rounded-lg border border-border/70 bg-background/60 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">学科</span>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={pdfController.selectedSubjectId ?? ''}
                      onChange={(event) =>
                        pdfController.setSelectedSubjectId(
                          event.target.value ? Number(event.target.value) : null,
                        )
                      }
                      disabled={subjectsLoading}
                    >
                      <option value="">请选择学科</option>
                      {subjectOptions.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">PDF 资料</span>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={pdfController.selectedSubjectDocumentId ?? ''}
                      onChange={(event) =>
                        pdfController.setSelectedSubjectDocumentId(
                          event.target.value ? Number(event.target.value) : null,
                        )
                      }
                      disabled={!pdfController.selectedSubjectId || pdfController.subjectDocumentsLoading}
                    >
                      <option value="">请选择 PDF</option>
                      {pdfController.subjectDocuments.map((document: SubjectDocumentSummary) => (
                        <option key={document.id} value={document.id}>
                          {document.original_name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    ref={subjectPdfUploadInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(event) => {
                      const input = event.currentTarget
                      const file = event.target.files?.[0]
                      if (!file) return
                      void onUploadSubjectPdf(file)
                        .catch((nextError) => {
                          toast.error(nextError instanceof Error ? nextError.message : 'PDF 上传失败。')
                        })
                        .finally(() => {
                          input.value = ''
                        })
                    }}
                    disabled={!pdfController.selectedSubjectId}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => subjectPdfUploadInputRef.current?.click()}
                    disabled={!pdfController.selectedSubjectId}
                  >
                    <Plus className="size-4" />
                    上传新 PDF 到资料库
                  </Button>
                  <Button type="button" variant="outline" onClick={onAddCurrentPdfSource}>
                    <Plus className="size-4" />
                    加入本次资料集
                  </Button>
                </div>

                <div className="grid gap-2">
                  <span className="text-sm font-medium">页码范围</span>
                  <Input
                    value={pdfController.pdfPageInput}
                    onChange={(event) => pdfController.setPdfPageInput(event.target.value)}
                    placeholder="例如：3,4,8-10"
                  />
                  {pdfController.pdfSelectionError ? (
                    <div className="text-xs text-destructive">{pdfController.pdfSelectionError}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      已选择 {pdfController.selectedPdfPages.length} 页
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  PDF 页面预览已关闭。请直接输入页码范围，例如 15,16,17 或 15-17。
                </div>

                <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">本次已加入的 PDF 资料</div>
                    <div className="text-xs text-muted-foreground">
                      共 {generationPdfSources.length} 份
                    </div>
                  </div>
                  {generationPdfSources.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      先选中一份 PDF 和页码，再点“加入本次资料集”。可以把题目、答案、解析分开加入。
                    </div>
                  ) : (
                    generationPdfSources.map((source) => (
                      <div
                        key={source.subject_document_id}
                        className="rounded-lg border border-border/70 bg-background/70 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 text-sm">
                            <div className="font-medium">{source.document_name}</div>
                            <div className="text-muted-foreground">
                              页码：{source.page_selection.join(', ')}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <select
                              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                              value={source.role_hint || 'question'}
                              onChange={(event) =>
                                onPdfSourceRoleHintChange(
                                  source.subject_document_id,
                                  event.target.value as 'question' | 'answer',
                                )
                              }
                            >
                              <option value="question">题目</option>
                              <option value="answer">答案</option>
                            </select>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => onRemovePdfSource(source.subject_document_id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border border-border/70 bg-background/60 p-4">
                {generationSourceKind === 'text-files' ? (
                  <div className="space-y-3 rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm">
                    <div className="font-medium">文本文件导入说明</div>
                    <div className="text-muted-foreground">
                      支持标准 JSON，也支持题目文件和答案文件成对上传，例如
                      *_questions.txt + *_answers.txt。标准 JSON 可包含全部题型；教材式 TXT 会自动提取选择题和主观题。
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background p-3 text-xs text-muted-foreground">
                      <div className="mb-2 font-medium text-foreground">给 AI 的格式修正提示词</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans leading-5">
                        {MANUAL_TEXT_FORMAT_PROMPT}
                      </pre>
                      <Button
                        type="button"
                        className="mt-3"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard?.writeText(MANUAL_TEXT_FORMAT_PROMPT)
                          toast.success('格式修正提示词已复制')
                        }}
                      >
                        复制提示词
                      </Button>
                    </div>
                  </div>
                ) : null}
                <label className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/70 px-4 py-6 text-center">
                  <input
                    type="file"
                    accept={generationSourceKind === 'text-files' ? '.txt,.md,.markdown,.json,text/plain,application/json' : 'image/*'}
                    multiple={generationSourceKind === 'image-batch' || generationSourceKind === 'text-files'}
                    className="hidden"
                    onChange={(event) => onImageFileChange(event.target.files)}
                  />
                  {generationSourceKind === 'text-files' ? (
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  )}
                  <div className="mt-3 text-sm font-medium">
                    {generationSourceKind === 'text-files'
                      ? '上传文本文件'
                      : generationSourceKind === 'image-batch'
                        ? '上传多张图片'
                        : '上传一张图片'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {generationSourceKind === 'text-files'
                      ? '可一次选择题目文件、答案文件或标准 JSON。'
                      : '点击选择文件后直接开始准备资料。'}
                  </div>
                </label>
                {generationFiles.length > 0 ? (
                  <div className="space-y-2">
                    {generationFiles.map((file) => (
                      <div
                        key={`${file.name}_${file.size}`}
                        className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm"
                      >
                        {file.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {generationSourceKind === 'text-files' ? '还没有文本文件。' : '还没有图片。'}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <span className="text-sm font-medium">额外提示词</span>
              <Textarea
                value={pdfController.rangePrompt}
                onChange={(event) => pdfController.setRangePrompt(event.target.value)}
                placeholder="这里会与系统模板自动拼接，而不是覆盖。你可以补充题型偏好、难度要求、重点页码等。"
                rows={4}
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={generationEnableSecondaryReview}
                onChange={(event) => setGenerationEnableSecondaryReview(event.target.checked)}
              />
              <span>
                <span className="font-medium">二次筛选</span>
                <span className="mt-1 block text-muted-foreground">
                  开启后，会在题目生成或题答配对完成后，再按当前额外提示词做一次通用范围复核。关闭后，直接保留生成结果，不额外裁剪。
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={generationClassifyByMiniPalace}
                onChange={(event) => setGenerationClassifyByMiniPalace(event.target.checked)}
                disabled={!selectedChapterHasChildren}
              />
              <span>
                <span className="font-medium">按小宫殿分类保存</span>
                <span className="mt-1 block text-muted-foreground">
                  {selectedChapterHasChildren
                    ? '开启后，题目会按当前所选范围的直接子章节分类，并以章节题的形式分别保存。'
                    : '当前范围没有直接子章节，暂时无法分类保存。'}
                </span>
              </span>
            </label>

            {generationError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {generationError}
              </div>
            ) : null}

            <Button type="button" disabled={generationLoading} onClick={() => void onGeneratePreview()}>
              {generationLoading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Brain className="size-4" />
              )}
              生成预览
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-card/92">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">历史生成记录</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              点击一条可回填到左侧配置，也可以直接按原配置重新生成。
            </div>
          </div>
          <Badge variant="outline">{generationHistory.length} 条</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {generationHistory.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
              还没有历史记录。先完成一次生成预览，这里会自动保存最近配置。
            </div>
          ) : (
            generationHistory.map((item) => {
              const canRegenerate = item.sourceKind === 'subject-pdf'
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/70 bg-background/70 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onApplyHistoryConfig(item)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        <Badge variant="secondary">
                          {item.sourceKind === 'subject-pdf'
                            ? 'PDF'
                            : item.sourceKind === 'image-single'
                              ? '单图'
                              : item.sourceKind === 'text-files'
                                ? '文本'
                                : '多图'}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                        <span>预览 {item.previewQuestionCount} 题</span>
                        <span>可保存 {item.savableQuestionCount} 题</span>
                        {item.classifyByMiniPalace ? <span>按小宫殿分类保存</span> : null}
                        {item.enableSecondaryReview ? <span>二次筛选</span> : null}
                      </div>
                      {item.selectedChapterPath ? (
                        <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          范围：{item.selectedChapterPath}
                        </div>
                      ) : null}
                      {item.extraPrompt ? (
                        <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          提示词：{item.extraPrompt}
                        </div>
                      ) : null}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteGenerationHistory(item.id)}
                      title="删除历史记录"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => onApplyHistoryConfig(item)}>
                      导入到左侧
                    </Button>
                    <Button
                      type="button"
                      disabled={!canRegenerate || generationLoading}
                      onClick={() => void onRegenerateFromHistory(item)}
                    >
                      {historyRegeneratingId === item.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                      重新生成
                    </Button>
                  </div>
                  {!canRegenerate ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      文件历史会回填提示词和开关，但仍需重新上传源文件。
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/92">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">预览后保存</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              追加会保留当前范围旧题；覆盖会先删除当前所选章节范围内旧题。
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {generationPreview ? (
              <span className="text-xs text-muted-foreground">
                将保存 {getGenerationPreviewSaveCount(generationPreview)} 题
              </span>
            ) : null}
            <Button
              type="button"
              disabled={!generationPreview || generationSaving}
              onClick={() => void onSaveGenerationPreview()}
            >
              {generationSaving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              保存到题库
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={generationSaveMode === 'append' ? 'default' : 'outline'}
              onClick={() => setGenerationSaveMode('append')}
            >
              追加保存
            </Button>
            <Button
              type="button"
              size="sm"
              variant={generationSaveMode === 'overwrite' ? 'default' : 'outline'}
              onClick={() => setGenerationSaveMode('overwrite')}
            >
              覆盖当前范围
            </Button>
          </div>

          {generationLoading || generationStreamStatus || generationStreamPreviewText ? (
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">实时模型输出</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {generationStreamStepLabel ? (
                    <Badge variant="outline">{generationStreamStepLabel}</Badge>
                  ) : null}
                  <span>{generationStreamStatus || '等待生成'}</span>
                </div>
              </div>
              <div
                className={cn(
                  'rounded-lg border border-border/70 bg-background p-3',
                  !generationStreamPreviewText &&
                    'flex min-h-[160px] items-center justify-center text-sm text-muted-foreground',
                )}
              >
                {generationStreamPreviewText ? (
                  <pre
                    ref={generationStreamContentRef}
                    onScroll={onGenerationStreamScroll}
                    data-testid="palace-quiz-generation-stream-preview"
                    className="max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground"
                  >
                    {generationStreamPreviewText}
                  </pre>
                ) : (
                  '点击生成后，这里会持续显示模型原始输出。'
                )}
              </div>
            </div>
          ) : null}

          {!generationPreview ? (
            <div className="rounded-lg border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
              先生成预览，这里会显示 AI 返回的题目草稿。确认后再批量写入题库。
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                <div>当前范围：{selectedChapterSummary}</div>
                来源：{generationPreview.source_meta.source_kind} · 模式：
                {generationPreview.source_meta.generation_mode}
                {formatResolvedAiSteps(generationPreview.resolved_ai_steps) ? (
                  <span> · {formatResolvedAiSteps(generationPreview.resolved_ai_steps)}</span>
                ) : generationPreview.resolved_ai?.model_label ? (
                  <span> · 实际模型 {generationPreview.resolved_ai.model_label}</span>
                ) : null}
                {generationPreview.generation_stats ? (
                  <span>
                    {' '}
                    · AI返回 {generationPreview.generation_stats.returned_count} 题，可保存{' '}
                    {generationPreview.generation_stats.savable_count} 题，跳过{' '}
                    {generationPreview.generation_stats.skipped_count} 题
                  </span>
                ) : (
                  <span> · 可保存 {getGenerationPreviewSaveCount(generationPreview)} 题</span>
                )}
                {generationPreview.ai_call_log_id ? (
                  <span> · AI日志 {generationPreview.ai_call_log_id}</span>
                ) : null}
                {generationPreview.source_meta.pdf_sources?.length ? (
                  <div className="mt-2 space-y-1">
                    {generationPreview.source_meta.pdf_sources.map(
                      (source: PalaceQuizPdfSourceMeta, index: number) => (
                        <div key={`${source.subject_document_id ?? 'pdf'}_${index}`}>
                          {index + 1}. {source.document_name || `PDF ${index + 1}`}
                          {source.page_numbers?.length ? ` · 页码 ${source.page_numbers.join(', ')}` : ''}
                          {source.role_hint
                            ? ` · 角色 ${source.role_hint === 'answer' ? '答案' : '题目'}`
                            : ''}
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
              {generationPreview.warnings?.length ? (
                <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
                  {generationPreview.warnings.join('；')}
                </div>
              ) : null}

              {generationPreview.grouped_questions ? (
                <div className="space-y-4">
                  {generationPreview.grouped_questions.child_chapter_groups?.map((group) => (
                    <div key={group.classified_chapter_id} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{group.classified_chapter_name}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {group.questions.length} 题
                        </span>
                      </div>
                      {group.questions.map((question, index) => (
                        <PreviewQuestionCard
                          key={`${group.classified_chapter_id}_${index}_${question.stem}`}
                          question={question}
                          index={index}
                        />
                      ))}
                    </div>
                  ))}
                  {(generationPreview.grouped_questions.mini_palace_groups || []).map((group) => (
                    <div key={group.mini_palace_id} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{group.mini_palace_name}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {group.questions.length} 题
                        </span>
                      </div>
                      {group.questions.map((question, index) => (
                        <PreviewQuestionCard
                          key={`${group.mini_palace_id}_${index}_${question.stem}`}
                          question={question}
                          index={index}
                        />
                      ))}
                    </div>
                  ))}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {generationPreview.grouped_questions.child_chapter_groups?.length
                          ? '未归类，仍保存到当前所选范围'
                          : '未归类，仍保存到大宫殿'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {generationPreview.grouped_questions.unassigned_questions.length} 题
                      </span>
                    </div>
                    {generationPreview.grouped_questions.unassigned_questions.map((question, index) => (
                      <PreviewQuestionCard
                        key={`unassigned_${index}_${question.stem}`}
                        question={question}
                        index={index}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {generationPreview.questions.map((question, index) => (
                    <PreviewQuestionCard
                      key={`${question.question_type}_${index}_${question.stem}`}
                      question={question}
                      index={index}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
