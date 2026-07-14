import { useEffect, useMemo, useState } from 'react'
import { Layers3, Play, RotateCcw, Save, ShieldCheck, WandSparkles } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import type {
  AiPromptBlock,
  AiPromptBlockVersion,
  AiPromptSceneDefault,
  AiPromptSceneVersion,
  AiPromptTemplate,
} from '@/shared/api/contracts'
import {
  activateAiPromptBlockVersionApi,
  activateAiPromptSceneVersionApi,
  activateAiPromptVersionApi,
  getAiPromptBlocksApi,
  getAiPromptBlockVersionsApi,
  getAiPromptScenesApi,
  getAiPromptSceneVersionsApi,
  getAiPromptTemplatesApi,
  resetAiPromptTemplatesApi,
  runAiPromptEvalApi,
  saveAiPromptBlockApi,
  saveAiPromptSceneDefaultApi,
  updateAiPromptTemplatesApi,
} from '@/features/profile/api'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Textarea } from '@/shared/components/ui/textarea'

function buildDraftMap(items: AiPromptTemplate[]) {
  return Object.fromEntries(items.map((item) => [item.key, item.template]))
}

export function ProfileAiPromptsPage({ standalone = false }: { standalone?: boolean }) {
  const [activeTab, setActiveTab] = useState<'scenes' | 'blocks' | 'legacy'>('scenes')
  const [items, setItems] = useState<AiPromptTemplate[]>([])
  const [blocks, setBlocks] = useState<AiPromptBlock[]>([])
  const [scenes, setScenes] = useState<AiPromptSceneDefault[]>([])
  const [blockDrafts, setBlockDrafts] = useState<Record<string, AiPromptBlock>>({})
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, AiPromptSceneDefault>>({})
  const [blockVersions, setBlockVersions] = useState<Record<string, AiPromptBlockVersion[]>>({})
  const [sceneVersions, setSceneVersions] = useState<Record<string, AiPromptSceneVersion[]>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [resettingKeys, setResettingKeys] = useState<Record<string, boolean>>({})
  const [resettingAll, setResettingAll] = useState(false)
  const [evaluatingKeys, setEvaluatingKeys] = useState<Record<string, boolean>>({})
  const [publishingKeys, setPublishingKeys] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const load = async () => {
      const [response, blockResponse, sceneResponse] = await Promise.all([
        getAiPromptTemplatesApi(),
        getAiPromptBlocksApi(),
        getAiPromptScenesApi(),
      ])
      setItems(response.items)
      setDrafts(buildDraftMap(response.items))
      setBlocks(blockResponse.items)
      setBlockDrafts(Object.fromEntries(blockResponse.items.map((item) => [item.key, item])))
      setScenes(sceneResponse.items)
      setSceneDrafts(Object.fromEntries(sceneResponse.items.map((item) => [item.scene_key, item])))
    }
    void load()
  }, [])

  const hasItems = items.length > 0
  const dirtyKeys = useMemo(
    () =>
      new Set(
        items
          .filter((item) => (drafts[item.key] ?? '') !== item.template)
          .map((item) => item.key),
      ),
    [drafts, items],
  )

  const syncItems = (nextItems: AiPromptTemplate[]) => {
    setItems(nextItems)
    setDrafts(buildDraftMap(nextItems))
  }

  const handleSaveOne = async (item: AiPromptTemplate) => {
    setSavingKeys((current) => ({ ...current, [item.key]: true }))
    try {
      const response = await updateAiPromptTemplatesApi({ [item.key]: drafts[item.key] ?? '' })
      syncItems(response.items)
      toast.success(`${item.label} 已保存为候选版本，请运行评测`)
    } finally {
      setSavingKeys((current) => ({ ...current, [item.key]: false }))
    }
  }

  const handleResetOne = async (item: AiPromptTemplate) => {
    setResettingKeys((current) => ({ ...current, [item.key]: true }))
    try {
      const response = await resetAiPromptTemplatesApi([item.key])
      syncItems(response.items)
      toast.success(`${item.label} 的默认模板已保存为候选版本`)
    } finally {
      setResettingKeys((current) => ({ ...current, [item.key]: false }))
    }
  }

  const handleResetAll = async () => {
    setResettingAll(true)
    try {
      const response = await resetAiPromptTemplatesApi()
      syncItems(response.items)
      toast.success('全部默认模板已保存为候选版本')
    } finally {
      setResettingAll(false)
    }
  }

  const reload = async () => {
    const response = await getAiPromptTemplatesApi()
    syncItems(response.items)
  }

  const handleEvaluate = async (item: AiPromptTemplate) => {
    const candidate = item.candidate_version
    if (!candidate) return
    setEvaluatingKeys((current) => ({ ...current, [item.key]: true }))
    try {
      const run = await runAiPromptEvalApi(item.key, candidate.id)
      toast.success(run.gate_passed ? `${item.label} 评测通过` : `${item.label} 评测未通过`)
      await reload()
    } finally {
      setEvaluatingKeys((current) => ({ ...current, [item.key]: false }))
    }
  }

  const handlePublish = async (item: AiPromptTemplate) => {
    const candidate = item.candidate_version
    if (!candidate || candidate.status !== 'passed') return
    setPublishingKeys((current) => ({ ...current, [item.key]: true }))
    try {
      await activateAiPromptVersionApi(item.key, candidate.id)
      toast.success(`${item.label} 已发布`)
      await reload()
    } finally {
      setPublishingKeys((current) => ({ ...current, [item.key]: false }))
    }
  }

  const handleSaveBlock = async (blockKey: string) => {
    const draft = blockDrafts[blockKey]
    if (!draft) return
    if (draft.affected_scene_keys.length > 0) {
      const confirmed = window.confirm(
        `修改会同步影响：${draft.affected_scene_keys.join('、')}。确认发布新版本吗？`,
      )
      if (!confirmed) return
    }
    const saved = await saveAiPromptBlockApi(draft)
    setBlocks((current) => current.map((item) => (item.key === blockKey ? saved : item)))
    setBlockDrafts((current) => ({ ...current, [blockKey]: saved }))
    setBlockVersions((current) => ({ ...current, [blockKey]: [] }))
    toast.success(`${saved.label} 已全局更新并保留旧版本`)
  }

  const handleLoadBlockVersions = async (blockKey: string) => {
    const response = await getAiPromptBlockVersionsApi(blockKey)
    setBlockVersions((current) => ({ ...current, [blockKey]: response.items }))
  }

  const handleActivateBlockVersion = async (blockKey: string, versionId: string) => {
    const saved = await activateAiPromptBlockVersionApi(blockKey, versionId)
    setBlocks((current) => current.map((item) => (item.key === blockKey ? saved : item)))
    setBlockDrafts((current) => ({ ...current, [blockKey]: saved }))
    await handleLoadBlockVersions(blockKey)
    toast.success(`${saved.label} 已回滚`)
  }

  const handleSaveScene = async (sceneKey: string) => {
    const draft = sceneDrafts[sceneKey]
    if (!draft) return
    const saved = await saveAiPromptSceneDefaultApi(sceneKey, {
      block_keys: draft.block_keys,
      scene_instruction: draft.scene_instruction,
    })
    setScenes((current) => current.map((item) => (item.scene_key === sceneKey ? saved : item)))
    setSceneDrafts((current) => ({ ...current, [sceneKey]: saved }))
    setSceneVersions((current) => ({ ...current, [sceneKey]: [] }))
    toast.success(`${saved.label} 已设为以后默认`)
  }

  const handleLoadSceneVersions = async (sceneKey: string) => {
    const response = await getAiPromptSceneVersionsApi(sceneKey)
    setSceneVersions((current) => ({ ...current, [sceneKey]: response.items }))
  }

  const handleActivateSceneVersion = async (sceneKey: string, versionId: string) => {
    const saved = await activateAiPromptSceneVersionApi(sceneKey, versionId)
    setScenes((current) => current.map((item) => (item.scene_key === sceneKey ? saved : item)))
    setSceneDrafts((current) => ({ ...current, [sceneKey]: saved }))
    await handleLoadSceneVersions(sceneKey)
    toast.success(`${saved.label} 已回滚`)
  }

  if (!hasItems) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        Loading...
      </div>
    )
  }

  const content = (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={activeTab === 'scenes' ? 'default' : 'outline'} onClick={() => setActiveTab('scenes')}>
          场景默认组合
        </Button>
        <Button type="button" variant={activeTab === 'blocks' ? 'default' : 'outline'} onClick={() => setActiveTab('blocks')}>
          提示词块库
        </Button>
        <Button type="button" variant={activeTab === 'legacy' ? 'default' : 'outline'} onClick={() => setActiveTab('legacy')}>
          完整模板兼容
        </Button>
      </div>

      {activeTab === 'scenes' ? (
        <div className="space-y-4">
          {scenes.map((scene) => {
            const draft = sceneDrafts[scene.scene_key] ?? scene
            const versions = sceneVersions[scene.scene_key] ?? []
            return (
              <Card key={scene.scene_key}>
                <CardHeader className="space-y-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers3 className="size-4" />
                    {scene.label}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{scene.description}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{scene.scene_key}</Badge>
                    <Badge variant="secondary">{draft.block_keys.length} 个提示词块</Badge>
                    <Badge variant="outline">约 {scene.estimated_tokens} Token</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {blocks.filter((block) => block.is_active).map((block) => (
                      <label key={block.key} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
                          checked={draft.block_keys.includes(block.key)}
                          onChange={(event) => {
                            setSceneDrafts((current) => {
                              const currentDraft = current[scene.scene_key] ?? scene
                              return {
                                ...current,
                                [scene.scene_key]: {
                                  ...currentDraft,
                                  block_keys: event.target.checked
                                    ? [...currentDraft.block_keys, block.key]
                                    : currentDraft.block_keys.filter((key) => key !== block.key),
                                },
                              }
                            })
                          }}
                        />
                        <span>
                          <span className="block font-medium">{block.label}</span>
                          <span className="text-xs text-muted-foreground">{block.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">场景特殊提示词</span>
                    <Textarea
                      value={draft.scene_instruction}
                      onChange={(event) => setSceneDrafts((current) => ({
                        ...current,
                        [scene.scene_key]: { ...(current[scene.scene_key] ?? scene), scene_instruction: event.target.value },
                      }))}
                      rows={8}
                      className="font-mono text-xs leading-6"
                    />
                  </label>
                  {scene.warnings.map((warning) => (
                    <div key={warning} className="text-xs text-amber-600">{warning}</div>
                  ))}
                  <details className="rounded-xl border p-4">
                    <summary className="cursor-pointer text-sm font-medium">查看当前编译结果</summary>
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{scene.compiled_prompt}</pre>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => { void handleSaveScene(scene.scene_key) }}>
                      <Save className="mr-2 size-4" />设为以后默认
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => { void handleLoadSceneVersions(scene.scene_key) }}>
                      历史版本
                    </Button>
                  </div>
                  {versions.length > 0 ? (
                    <div className="space-y-2 rounded-lg border p-3">
                      {versions.map((version) => (
                        <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>{version.status} · {version.source} · {version.created_at ?? ''}</span>
                          {version.status !== 'active' ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => { void handleActivateSceneVersion(scene.scene_key, version.id) }}>
                              回滚到此版本
                            </Button>
                          ) : <Badge variant="secondary">当前</Badge>}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}

      {activeTab === 'blocks' ? (
        <div className="space-y-4">
          {blocks.map((block) => {
            const draft = blockDrafts[block.key] ?? block
            const versions = blockVersions[block.key] ?? []
            return (
              <Card key={block.key}>
                <CardHeader className="space-y-2">
                  <CardTitle className="text-base">{block.label}</CardTitle>
                  <p className="text-sm text-muted-foreground">{block.description}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{block.layer}</Badge>
                    <Badge variant={block.is_builtin ? 'secondary' : 'outline'}>{block.is_builtin ? '内置共享块' : '自定义块'}</Badge>
                    <Badge variant="outline">影响 {block.affected_scene_keys.length} 个场景</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    value={draft.template}
                    onChange={(event) => setBlockDrafts((current) => ({
                      ...current,
                      [block.key]: { ...(current[block.key] ?? block), template: event.target.value },
                    }))}
                    rows={Math.max(5, Math.min(14, draft.template.split('\n').length + 2))}
                    className="font-mono text-xs leading-6"
                  />
                  {block.affected_scene_keys.length > 0 ? (
                    <p className="text-xs text-amber-600">保存将同步影响：{block.affected_scene_keys.join('、')}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => { void handleSaveBlock(block.key) }}>
                      <Save className="mr-2 size-4" />全局发布
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => { void handleLoadBlockVersions(block.key) }}>
                      历史版本
                    </Button>
                  </div>
                  {versions.length > 0 ? (
                    <div className="space-y-2 rounded-lg border p-3">
                      {versions.map((version) => (
                        <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>{version.status} · {version.source} · {version.created_at ?? ''}</span>
                          {version.status !== 'active' ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => { void handleActivateBlockVersion(block.key, version.id) }}>
                              回滚到此版本
                            </Button>
                          ) : <Badge variant="secondary">当前</Badge>}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}

      {activeTab === 'legacy' ? (
        <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">共 {items.length} 组提示词</Badge>
        <Badge variant="secondary">已改动 {dirtyKeys.size}</Badge>
        <Button type="button" variant="outline" size="sm" onClick={handleResetAll} disabled={resettingAll}>
          <RotateCcw className="mr-2 size-4" />
          {resettingAll ? '重置中...' : '全部恢复默认'}
        </Button>
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const draftValue = drafts[item.key] ?? item.template
          const isDirty = dirtyKeys.has(item.key)
          const isSaving = Boolean(savingKeys[item.key])
          const isResetting = Boolean(resettingKeys[item.key])
          const isEvaluating = Boolean(evaluatingKeys[item.key])
          const isPublishing = Boolean(publishingKeys[item.key])
          const candidate = item.candidate_version
          return (
            <Card key={item.key}>
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <WandSparkles className="size-4" />
                      {item.label}
                    </CardTitle>
                    <p className="max-w-3xl text-sm text-muted-foreground">{item.description}</p>
                    {item.source_location ? (
                      <p className="text-xs text-muted-foreground/70 font-mono">
                        文件：{item.source_location}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {candidate ? (
                      <Badge variant={candidate.status === 'passed' ? 'secondary' : candidate.status === 'failed' ? 'destructive' : 'outline'}>
                        候选：{candidate.status}
                      </Badge>
                    ) : null}
                    <Badge variant={item.is_customized ? 'secondary' : 'outline'}>
                      {item.is_customized ? '已自定义' : '默认模板'}
                    </Badge>
                    {isDirty ? <Badge variant="secondary">未保存</Badge> : null}
                  </div>
                </div>
                {item.available_placeholders.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {item.available_placeholders.map((placeholder) => (
                      <Badge key={placeholder.name} variant="outline" title={placeholder.description}>
                        {`{{${placeholder.name}}}`}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={draftValue}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [item.key]: event.target.value }))
                  }
                  rows={Math.max(10, Math.min(22, draftValue.split('\n').length + 2))}
                  className="font-mono text-xs leading-6"
                />

                <details className="rounded-xl border border-border/70 bg-background/70 p-4">
                  <summary className="cursor-pointer text-sm font-medium">查看默认模板</summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {item.default_template}
                  </pre>
                </details>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void handleSaveOne(item)} disabled={isSaving || !isDirty}>
                    <Save className="mr-2 size-4" />
                    {isSaving ? '保存中...' : '保存候选'}
                  </Button>
                  {candidate ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleEvaluate(item)} disabled={isEvaluating}>
                      <Play className="mr-2 size-4" />
                      {isEvaluating ? '评测中...' : '运行评测'}
                    </Button>
                  ) : null}
                  {candidate?.status === 'passed' ? (
                    <Button type="button" size="sm" onClick={() => void handlePublish(item)} disabled={isPublishing}>
                      <ShieldCheck className="mr-2 size-4" />
                      {isPublishing ? '发布中...' : '发布'}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleResetOne(item)} disabled={isResetting}>
                    <RotateCcw className="mr-2 size-4" />
                    {isResetting ? '重置中...' : '恢复默认'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
        </>
      ) : null}
    </div>
  )

  if (standalone) {
    return (
      <ProfileLayout
        title="AI 提示词"
        description="这里可以编辑 AI 提示词。保存会创建候选版本，只有评测通过并发布后才会作用于后续请求。"
      >
        {content}
      </ProfileLayout>
    )
  }

  return content
}

export default ProfileAiPromptsPage
