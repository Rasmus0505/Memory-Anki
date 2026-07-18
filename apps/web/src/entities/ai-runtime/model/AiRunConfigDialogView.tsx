import * as React from 'react'
import type {
  AiModelScenario,
  AiPromptBlock,
  AiPromptSceneDefault,
  AiRuntimeOptions,
} from '@/shared/api/contracts'
import type { PromptTemplateSnapshot } from './aiRunConfigPersistence'
import {
  compileLocalPromptPreview,
  filterBlocksForScene,
  groupBlocksByLayer,
  supportsEmphasisMarkDescription,
  type MultiScenarioEntry,
} from './aiRunConfigDialogHelpers'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

export interface AiRunConfigDialogEntryView {
  entry: MultiScenarioEntry
  scenario: AiModelScenario | null
  recentConfig: AiRuntimeOptions | null
  promptTemplate: PromptTemplateSnapshot | null
  promptScene: AiPromptSceneDefault | null
}

export interface AiRunConfigDialogViewProps {
  open: boolean
  title: string
  description?: string
  loading: boolean
  confirming: boolean
  currentEntries: AiRunConfigDialogEntryView[]
  selectedConfigs: Record<string, AiRuntimeOptions>
  selectedContexts: Record<string, string[]>
  promptBlocks: AiPromptBlock[]
  savingDefaults: Record<string, boolean>
  onClose: () => void
  onConfirm: () => void
  onResetAllDefaults: () => void
  onUpdateScenarioConfig: (
    scenarioKey: string,
    updater: (current: AiRuntimeOptions | undefined) => AiRuntimeOptions,
  ) => void
  onApplyScenarioDefault: (scenarioKey: string, promptSceneKey?: string) => void
  onApplyScenarioRecentChoice: (
    scenarioKey: string,
    entrypointKey: string,
    promptSceneKey?: string,
  ) => void
  onSaveCurrentAsDefault: (scenarioKey: string, promptSceneKey?: string) => void
  onSetSelectedContexts: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
}

export function AiRunConfigDialogView({
  open,
  title,
  description,
  loading,
  confirming,
  currentEntries,
  selectedConfigs,
  selectedContexts,
  promptBlocks,
  savingDefaults,
  onClose,
  onConfirm,
  onResetAllDefaults,
  onUpdateScenarioConfig,
  onApplyScenarioDefault,
  onApplyScenarioRecentChoice,
  onSaveCurrentAsDefault,
  onSetSelectedContexts,
}: AiRunConfigDialogViewProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? '每次生成前都可以调整模型和提示词；确认后本入口下次会默认使用这份配置。'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {currentEntries.map(({ entry, scenario, recentConfig, promptTemplate, promptScene }) => {
            const selectedConfig = selectedConfigs[entry.scenarioKey]
            const selectedModel = selectedConfig?.model?.trim() || ''
            const selectedModelMeta =
              scenario?.available_models.find((item) => item.key === selectedModel) ?? null
            const enabledContextIds = selectedContexts[entry.scenarioKey] ?? []
            const selection = selectedConfig?.prompt_options ?? {}
            const selectedBlockKeys = selection.block_keys ?? []
            const promptKey = entry.promptSceneKey ?? entry.scenarioKey
            const availableBlocks = filterBlocksForScene(
              promptBlocks,
              promptKey,
              promptScene,
              selectedBlockKeys,
            )
            const blockGroups = groupBlocksByLayer(availableBlocks)
            const recommendedKeys = new Set(promptScene?.recommended_block_keys ?? [])
            const localPreview = compileLocalPromptPreview(
              availableBlocks,
              selection,
              promptScene?.recommended_block_keys ?? [],
            )
            const contextCharacters = (entry.contextOptions ?? [])
              .filter((item) => enabledContextIds.includes(item.id))
              .reduce((total, item) => total + item.content.length, 0)
            const estimatedTokens = Math.ceil(
              ((selectedConfig?.prompt_override || localPreview.text).length + contextCharacters) / 1.5,
            )
            const exceedsBudget = estimatedTokens > 24000
            return (
              <div
                key={entry.scenarioKey}
                className="grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 lg:grid-cols-[320px_minmax(0,1fr)]"
              >
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {entry.label || scenario?.label || entry.scenarioKey}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.description
                        || scenario?.description
                        || '本次请求会直接使用这份配置。'}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-xs text-muted-foreground">
                    {scenario ? (
                      <>
                        <div>场景默认模型：{scenario.default_model}</div>
                        <div>场景默认思考：{scenario.default_thinking_enabled ? '开启' : '关闭'}</div>
                        <div>提示词场景：{promptKey}</div>
                      </>
                    ) : loading ? '正在加载场景配置...' : '未找到场景配置。'}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor={`ai-runtime-model-${entry.scenarioKey}`} className="text-sm font-medium">
                      本次模型
                    </label>
                    <select
                      id={`ai-runtime-model-${entry.scenarioKey}`}
                      value={selectedModel}
                      onChange={(event) => {
                        const nextModel = event.target.value
                        const nextMeta =
                          scenario?.available_models.find((item) => item.key === nextModel) ?? null
                        onUpdateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          model: nextModel,
                          thinking_enabled: nextMeta?.supports_thinking
                            ? Boolean(current?.thinking_enabled)
                            : false,
                        }))
                      }}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {(scenario?.available_models ?? []).map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label} · {item.provider}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedModelMeta?.supports_thinking ? (
                    <label className="flex items-center justify-between rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-sm">
                      <span>思考模式</span>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedConfig?.thinking_enabled)}
                        onChange={(event) => {
                          onUpdateScenarioConfig(entry.scenarioKey, (current) => ({
                            ...current,
                            model: current?.model,
                            thinking_enabled: event.target.checked,
                          }))
                        }}
                        className="size-4"
                      />
                    </label>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                      当前模型不支持思考模式。
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onApplyScenarioDefault(entry.scenarioKey, entry.promptSceneKey)}
                    >
                      恢复默认
                    </Button>
                    {recentConfig ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onApplyScenarioRecentChoice(
                            entry.scenarioKey,
                            entry.entrypointKey,
                            entry.promptSceneKey,
                          )
                        }
                      >
                        恢复最近一次
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="grid min-h-[260px] gap-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <span className="font-medium">提示词组合</span>
                      <div className="text-xs text-muted-foreground">
                        仅显示本场景相关块
                        {selectedBlockKeys.length > 0
                          ? ` · 已选 ${selectedBlockKeys.length}/${availableBlocks.length}`
                          : availableBlocks.length > 0
                            ? ' · 尚未勾选（将使用空组合）'
                            : ' · 本场景使用完整场景提示词'}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(savingDefaults[promptKey])}
                      onClick={() => {
                        void onSaveCurrentAsDefault(entry.scenarioKey, entry.promptSceneKey)
                      }}
                    >
                      {savingDefaults[promptKey] ? '保存中...' : '设为以后默认'}
                    </Button>
                  </div>

                  {availableBlocks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 bg-background/70 p-3 text-xs text-muted-foreground">
                      本场景没有可勾选的提示词块，直接编辑下方「场景特殊提示词」即可。
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-border/60 bg-background/70 p-3">
                      {blockGroups.map((group) => (
                        <div key={group.layer} className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.label}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {group.blocks.map((block) => (
                              <label
                                key={block.key}
                                className="flex items-start gap-2 rounded-md border bg-background p-2"
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1 size-4"
                                  checked={selectedBlockKeys.includes(block.key)}
                                  onChange={(event) => {
                                    onUpdateScenarioConfig(entry.scenarioKey, (current) => {
                                      const currentKeys = current?.prompt_options?.block_keys ?? []
                                      return {
                                        ...current,
                                        prompt_options: {
                                          ...current?.prompt_options,
                                          block_keys: event.target.checked
                                            ? [...currentKeys, block.key]
                                            : currentKeys.filter((key) => key !== block.key),
                                        },
                                      }
                                    })
                                  }}
                                />
                                <span>
                                  <span className="block font-medium">
                                    {block.label}
                                    {recommendedKeys.has(block.key) ? (
                                      <span className="ml-2 text-[10px] font-normal text-primary">推荐</span>
                                    ) : null}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{block.description}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <label className="grid gap-2">
                    <span className="font-medium">场景特殊提示词</span>
                    <textarea
                      aria-label="场景特殊提示词"
                      value={selection.scene_instruction ?? ''}
                      onChange={(event) => {
                        onUpdateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          prompt_options: {
                            ...current?.prompt_options,
                            scene_instruction: event.target.value,
                          },
                        }))
                      }}
                      className="min-h-[110px] resize-y rounded-lg border border-input bg-background px-4 py-3 font-mono text-xs leading-5"
                    />
                  </label>

                  {supportsEmphasisMarkDescription(entry.scenarioKey) ? (
                    <label className="grid gap-2">
                      <span className="font-medium">重点标记线索</span>
                      <div className="text-xs text-muted-foreground">
                        识别图中（下方填写）的文字作为知识重点；脑图会渲染为黄色底色。留空则不强制识别重点标记。
                      </div>
                      <input
                        type="text"
                        aria-label="重点标记线索"
                        value={selection.emphasis_mark_description ?? ''}
                        onChange={(event) => {
                          onUpdateScenarioConfig(entry.scenarioKey, (current) => ({
                            ...current,
                            prompt_options: {
                              ...current?.prompt_options,
                              emphasis_mark_description: event.target.value,
                            },
                          }))
                        }}
                        placeholder="带有下划线的文字、带有颜色的文字"
                        className="min-h-10 rounded-lg border border-input bg-background px-4 py-2 text-sm"
                      />
                    </label>
                  ) : null}

                  <label className="grid gap-2">
                    <span className="font-medium">本次运行追加要求</span>
                    <textarea
                      aria-label="本次运行追加要求"
                      value={selection.run_instruction ?? ''}
                      onChange={(event) => {
                        onUpdateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          prompt_options: {
                            ...current?.prompt_options,
                            run_instruction: event.target.value,
                          },
                        }))
                      }}
                      placeholder="仅影响本次运行，不会写入以后默认。"
                      className="min-h-[80px] resize-y rounded-lg border border-input bg-background px-4 py-3 text-sm"
                    />
                  </label>

                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
                    <div className="font-medium">最终编译预览</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-5">
                      {selectedConfig?.prompt_override?.trim() || localPreview.text || '当前组合为空。'}
                    </pre>
                    {localPreview.warnings.map((warning) => (
                      <div key={warning} className="text-xs text-amber-600">{warning}</div>
                    ))}
                  </div>

                  <details className="rounded-lg border border-dashed border-border/60 bg-background/60 p-3">
                    <summary className="cursor-pointer text-sm font-medium">完整覆盖（高级兼容）</summary>
                    <textarea
                      aria-label="完整覆盖提示词"
                      value={selectedConfig?.prompt_override ?? ''}
                      onChange={(event) => {
                        onUpdateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          prompt_override: event.target.value,
                        }))
                      }}
                      placeholder={promptTemplate?.defaultTemplate || '填写后将绕过提示词块组合。'}
                      className="mt-3 min-h-[140px] w-full resize-y rounded-lg border border-input bg-background px-4 py-3 font-mono text-xs leading-5"
                    />
                    <div className="mt-2 text-xs text-muted-foreground">
                      仅用于兼容旧流程；浏览器不会再把完整覆盖内容保存为以后默认。
                    </div>
                  </details>

                  {(entry.contextOptions ?? []).length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="font-medium">上下文快照</div>
                      {(entry.contextOptions ?? []).map((context) => (
                        <label key={context.id} className="flex items-start gap-2 rounded-md border bg-background/70 p-2">
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            checked={enabledContextIds.includes(context.id)}
                            onChange={(event) => {
                              onSetSelectedContexts((current) => {
                                const ids = current[entry.scenarioKey] ?? []
                                return {
                                  ...current,
                                  [entry.scenarioKey]: event.target.checked
                                    ? [...ids, context.id]
                                    : ids.filter((id) => id !== context.id),
                                }
                              })
                            }}
                          />
                          <span>
                            <span className="block font-medium">{context.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {context.description || `${context.content.length} 字，约 ${Math.ceil(context.content.length / 1.5)} Token`}
                            </span>
                          </span>
                        </label>
                      ))}
                      <div className={exceedsBudget ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                        当前调用包约 {estimatedTokens} Token
                        {exceedsBudget ? '，超过 24000 Token 安全预算，请减少上下文或提示词。' : '。'}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="outline" onClick={onResetAllDefaults}>
            重置默认
          </Button>
          <Button
            type="button"
            onClick={() => { void onConfirm() }}
            disabled={confirming || currentEntries.some(({ entry, scenario }) => {
              const selectedModel = selectedConfigs[entry.scenarioKey]?.model?.trim() || ''
              const selectedIds = selectedContexts[entry.scenarioKey] ?? []
              const contextCharacters = (entry.contextOptions ?? [])
                .filter((item) => selectedIds.includes(item.id))
                .reduce((total, item) => total + item.content.length, 0)
              const exceedsBudget = Math.ceil(
                ((selectedConfigs[entry.scenarioKey]?.prompt_override ?? '').length + contextCharacters) / 1.5,
              ) > 24000
              return exceedsBudget || !scenario?.available_models.some((item) => item.key === selectedModel)
            })}
          >
            {confirming ? '保存中...' : '开始生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
