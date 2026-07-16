import type { AiRuntimeOptions } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { TaskSteps } from '@/shared/background-tasks/TaskSteps'
import type { useAiSplitWorkbench } from '@/features/palace-edit/hooks/useAiSplitWorkbench'
import type { AiSplitPreviewNode } from '@/features/palace-edit/model/aiSplitPreview'

type Workbench = ReturnType<typeof useAiSplitWorkbench>

function PreviewTreeEditor({
  nodes,
  depth = 0,
  onTextChange,
  onDelete,
  onAddChild,
}: {
  nodes: AiSplitPreviewNode[]
  depth?: number
  onTextChange: (id: string, text: string) => void
  onDelete: (id: string) => void
  onAddChild: (parentId: string | null) => void
}) {
  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <div
          key={node.id}
          className="rounded-md border border-border/60 bg-background/80 p-2"
          style={{ marginLeft: depth * 12 }}
        >
          <div className="flex items-start gap-2">
            <textarea
              aria-label="分卡节点文字"
              value={node.text}
              onChange={(event) => onTextChange(node.id, event.target.value)}
              className="min-h-[56px] flex-1 resize-y rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
            <div className="flex flex-col gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => onAddChild(node.id)}>
                子卡
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => onDelete(node.id)}>
                删除
              </Button>
            </div>
          </div>
          {node.children.length > 0 ? (
            <div className="mt-2">
              <PreviewTreeEditor
                nodes={node.children}
                depth={depth + 1}
                onTextChange={onTextChange}
                onDelete={onDelete}
                onAddChild={onAddChild}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ConfigPanel({ workbench }: { workbench: Workbench }) {
  const {
    scenario,
    availableBlocks,
    aiConfig,
    loadingCatalog,
    updateAiConfig,
    resetConfigToDefault,
    structureMode,
    cardCountMode,
    targetCardCount,
    setStructureMode,
    setCardCountMode,
    setTargetCardCount,
  } = workbench
  const selectedModel = aiConfig.model?.trim() || ''
  const selectedModelMeta =
    scenario?.available_models.find((item) => item.key === selectedModel) ?? null
  const selectedBlockKeys = aiConfig.prompt_options?.block_keys ?? []

  const patchPrompt = (patch: Partial<NonNullable<AiRuntimeOptions['prompt_options']>>) => {
    updateAiConfig((current) => ({
      ...current,
      prompt_options: {
        ...current.prompt_options,
        ...patch,
      },
    }))
  }

  if (loadingCatalog) {
    return <div className="text-sm text-muted-foreground">正在加载模型与提示词组合…</div>
  }
  if (!scenario) {
    return <div className="text-sm text-destructive">未找到 AI 分卡场景配置，请先检查设置页。</div>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="rounded-lg border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
          <div>场景默认模型：{scenario.default_model}</div>
          <div>提示词场景：ai_split</div>
          <div className="mt-1 text-amber-700">生成结果会先进入预览，确认前不会写入脑图。</div>
        </div>

        <fieldset className="space-y-2 rounded-lg border border-border/60 p-3">
          <legend className="px-1 text-sm font-medium">结构</legend>
          <p className="text-xs text-muted-foreground">
            「并列卡」= 替换原长卡后并排出现的那一批；选「可以分层」时，它们下面还可以再有子卡。
          </p>
          {(
            [
              { value: 'auto' as const, label: '自动判断（推荐）', hint: 'AI 决定只要并列，还是带父子' },
              { value: 'parallel' as const, label: '只要并列', hint: '全部同级，不要子卡' },
              { value: 'hierarchy' as const, label: '可以分层', hint: '允许父子树（最多约 4 层）' },
            ] as const
          ).map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-1 size-4"
                name="ai-split-structure"
                checked={structureMode === option.value}
                onChange={() => setStructureMode(option.value)}
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-border/60 p-3">
          <legend className="px-1 text-sm font-medium">并列卡大约几张</legend>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1 size-4"
              name="ai-split-card-count"
              checked={cardCountMode === 'auto'}
              onChange={() => setCardCountMode('auto')}
            />
            <span>
              <span className="font-medium">自动</span>
              <span className="block text-xs text-muted-foreground">由内容长短决定</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1 size-4"
              name="ai-split-card-count"
              checked={cardCountMode === 'about'}
              onChange={() => setCardCountMode('about')}
            />
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">指定约</span>
              <input
                type="number"
                min={2}
                max={12}
                value={targetCardCount}
                disabled={cardCountMode !== 'about'}
                onChange={(event) => setTargetCardCount(Number(event.target.value))}
                onFocus={() => setCardCountMode('about')}
                className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              />
              <span className="text-muted-foreground">张（2–12，软目标）</span>
            </span>
          </label>
        </fieldset>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">本次模型</span>
          <select
            value={selectedModel}
            onChange={(event) => {
              const nextModel = event.target.value
              const meta = scenario.available_models.find((item) => item.key === nextModel)
              updateAiConfig((current) => ({
                ...current,
                model: nextModel,
                thinking_enabled: meta?.supports_thinking
                  ? Boolean(current.thinking_enabled)
                  : false,
              }))
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {scenario.available_models.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label} · {item.provider}
              </option>
            ))}
          </select>
        </label>
        {selectedModelMeta?.supports_thinking ? (
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
            <span>思考模式</span>
            <input
              type="checkbox"
              className="size-4"
              checked={Boolean(aiConfig.thinking_enabled)}
              onChange={(event) =>
                updateAiConfig((current) => ({
                  ...current,
                  thinking_enabled: event.target.checked,
                }))
              }
            />
          </label>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={resetConfigToDefault}>
          恢复默认组合
        </Button>
      </div>

      <div className="space-y-3">
        <div className="font-medium text-sm">提示词组合</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {availableBlocks.map((block) => (
            <label key={block.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={selectedBlockKeys.includes(block.key)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selectedBlockKeys, block.key]
                    : selectedBlockKeys.filter((key) => key !== block.key)
                  patchPrompt({ block_keys: next })
                }}
              />
              <span>
                <span className="block font-medium">{block.label}</span>
                <span className="text-xs text-muted-foreground">{block.description}</span>
              </span>
            </label>
          ))}
        </div>
        {availableBlocks.length === 0 ? (
          <div className="text-xs text-amber-700">
            当前没有可用提示词块。请到「个人中心 → AI 提示词」检查脑图分卡场景是否已种子化。
          </div>
        ) : null}
        <label className="grid gap-1 text-sm">
          <span className="font-medium">场景特殊提示词</span>
          <textarea
            value={aiConfig.prompt_options?.scene_instruction ?? ''}
            onChange={(event) => patchPrompt({ scene_instruction: event.target.value })}
            className="min-h-[90px] resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">本次运行追加要求</span>
          <textarea
            value={aiConfig.prompt_options?.run_instruction ?? ''}
            onChange={(event) => patchPrompt({ run_instruction: event.target.value })}
            placeholder="仅影响本次，不会写入以后默认。"
            className="min-h-[70px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
    </div>
  )
}

export function AiSplitWorkbench({
  workbench,
  currentSelectedLabel,
  hasCurrentSelection,
}: {
  workbench: Workbench
  currentSelectedLabel: string
  hasCurrentSelection: boolean
}) {
  const {
    open,
    phase,
    source,
    steps,
    progressDetail,
    generatingError,
    previewTree,
    previewNodeCount,
    applying,
    closeWorkbench,
    runGenerate,
    rerunGenerate,
    updatePreviewNodeText,
    deletePreviewNode,
    addPreviewChild,
    applyReplace,
    applyAppendAfterSelection,
  } = workbench

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeWorkbench()
      }}
      modal={false}
    >
      <DialogContent
        floatingId="ai-split-workbench"
        floating
        layout="centered"
        capsuleLabel="AI 分卡"
        expandOnOpen
        className="flex max-h-[min(92vh,900px)] max-w-[min(96vw,1100px)] flex-col overflow-hidden rounded-lg border bg-card/98 p-0 shadow-floating"
        dismissOnInteractOutside={false}
      >
        <DialogHeader>
          <DialogTitle>AI 分卡工作台</DialogTitle>
          <DialogDescription>
            {phase === 'config' && '配置模型与提示词后开始分卡；结果会先预览，确认前不会写入脑图。'}
            {phase === 'generating' && '正在生成分卡结果，请稍候。可把窗口拖开继续查看脑图。'}
            {phase === 'preview' && '左侧原文、右侧可编辑结果。尚未写入脑图；可替换原卡或追加到当前选中卡之后。'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {source ? (
            <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
              源卡片：{source.targetNodeText.slice(0, 80) || source.targetNodeUid}
              {source.targetNodeText.length > 80 ? '…' : ''}
            </div>
          ) : null}

          {phase === 'config' ? (
            <>
              {generatingError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {generatingError}
                </div>
              ) : null}
              <ConfigPanel workbench={workbench} />
            </>
          ) : null}

          {phase === 'generating' ? (
            <div className="space-y-4 rounded-lg border border-border/60 bg-muted/10 p-4">
              <TaskSteps steps={steps} className="flex-wrap" />
              <div className="text-sm text-muted-foreground">{progressDetail || '进行中…'}</div>
              <div className="text-xs text-muted-foreground">
                生成完成前不会修改脑图与学习组。可钉住/拖动本窗口，避免遮挡。
              </div>
            </div>
          ) : null}

          {phase === 'preview' ? (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                尚未写入脑图。约 {previewNodeCount} 张卡 · 主操作「替换原卡片」会在源位置原位替换。
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">原文（只读）</h3>
                  <div className="max-h-[48vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm leading-6">
                    {source?.targetNodeText || '（无正文）'}
                    {source?.targetNodeNote ? (
                      <>
                        {'\n\n'}
                        <span className="text-muted-foreground">备注：{source.targetNodeNote}</span>
                      </>
                    ) : null}
                  </div>
                </section>
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">分卡结果（可编辑）</h3>
                    <Button type="button" size="sm" variant="outline" onClick={() => addPreviewChild(null)}>
                      添加顶层卡
                    </Button>
                  </div>
                  <div className="max-h-[48vh] overflow-auto rounded-lg border bg-muted/10 p-2">
                    <PreviewTreeEditor
                      nodes={previewTree}
                      onTextChange={updatePreviewNodeText}
                      onDelete={deletePreviewNode}
                      onAddChild={addPreviewChild}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    追加目标：当前脑图选中 = {hasCurrentSelection ? currentSelectedLabel || '已选中' : '未选中（请点选卡片）'}
                    （将作为<strong>同级卡片</strong>插在其后，不会变成其子卡）
                  </div>
                </section>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {phase === 'config' ? (
            <>
              <Button type="button" variant="outline" onClick={closeWorkbench}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void runGenerate()
                }}
                disabled={!source || workbench.loadingCatalog || !workbench.scenario}
              >
                开始分卡
              </Button>
            </>
          ) : null}
          {phase === 'generating' ? (
            <Button type="button" variant="outline" onClick={closeWorkbench}>
              隐藏窗口
            </Button>
          ) : null}
          {phase === 'preview' ? (
            <>
              <Button type="button" variant="outline" onClick={closeWorkbench} disabled={applying}>
                不应用
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  rerunGenerate()
                }}
                disabled={applying}
              >
                重新分卡
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void applyAppendAfterSelection()
                }}
                disabled={applying || !hasCurrentSelection || previewTree.length === 0}
                title={
                  hasCurrentSelection
                    ? '作为同级卡片插在当前选中之后（不是子卡；不删除源卡）'
                    : '请先在脑图上点选卡片'
                }
              >
                作为同级追加到选中后
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void applyReplace()
                }}
                disabled={applying || previewTree.length === 0}
              >
                {applying ? '应用中…' : '替换原卡片'}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
