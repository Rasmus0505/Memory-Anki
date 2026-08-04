import { useEffect, useState } from 'react'
import { Layers3, Save } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import type {
  AiPromptBlock,
  AiPromptBlockVersion,
  AiPromptSceneDefault,
  AiPromptSceneVersion,
} from '@/shared/api/contracts'
import {
  activateAiPromptBlockVersionApi,
  activateAiPromptSceneVersionApi,
  getAiPromptBlocksApi,
  getAiPromptBlockVersionsApi,
  getAiPromptScenesApi,
  getAiPromptSceneVersionsApi,
  saveAiPromptBlockApi,
  saveAiPromptSceneDefaultApi,
} from '@/modules/settings/domain/preferences-entity/api'
import {
  filterBlocksForScene,
  groupBlocksByLayer,
} from '@/modules/settings/domain/ai-runtime-entity'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Textarea } from '@/shared/components/ui/textarea'

const SCENE_CATEGORY_ORDER = [
  '脑图导入',
  'OCR 与整理',
  '脑图分卡',
  '记忆与复习',
  '做题',
  '英语',
  '批量生成',
  '其他',
]

export function ProfileAiPromptsPage({
  standalone = false,
  view,
}: {
  standalone?: boolean
  view?: 'scenes' | 'blocks'
}) {
  const [activeTab, setActiveTab] = useState<'scenes' | 'blocks'>(view ?? 'scenes')
  const visibleTab = view === 'scenes' ? 'scenes' : activeTab
  const [blocks, setBlocks] = useState<AiPromptBlock[]>([])
  const [scenes, setScenes] = useState<AiPromptSceneDefault[]>([])
  const [blockDrafts, setBlockDrafts] = useState<Record<string, AiPromptBlock>>({})
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, AiPromptSceneDefault>>({})
  const [blockVersions, setBlockVersions] = useState<Record<string, AiPromptBlockVersion[]>>({})
  const [sceneVersions, setSceneVersions] = useState<Record<string, AiPromptSceneVersion[]>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [blockResponse, sceneResponse] = await Promise.all([
        getAiPromptBlocksApi(),
        getAiPromptScenesApi(),
      ])
      setBlocks(blockResponse.items)
      setBlockDrafts(Object.fromEntries(blockResponse.items.map((item) => [item.key, item])))
      setScenes(sceneResponse.items)
      setSceneDrafts(Object.fromEntries(sceneResponse.items.map((item) => [item.scene_key, item])))
      setLoaded(true)
    }
    void load()
  }, [])

  const handleSaveBlock = async (blockKey: string) => {
    const draft = blockDrafts[blockKey]
    if (!draft) return
    if (
      draft.affected_scene_keys.length > 0 &&
      !(await appConfirm(
        `修改会同步影响 ${draft.affected_scene_keys.length} 个场景：${draft.affected_scene_keys.join('、')}。`,
        { title: '全局发布提示词块', confirmText: '确认发布', tone: 'danger' },
      ))
    ) return
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

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        Loading...
      </div>
    )
  }

  const content = (
    <div className="space-y-6">
      {view !== 'scenes' ? (
        <div className="flex flex-wrap gap-2">
          {view ? null : (
            <Button type="button" variant={visibleTab === 'scenes' ? 'default' : 'outline'} onClick={() => setActiveTab('scenes')}>
              场景默认组合
            </Button>
          )}
          <Button type="button" variant={visibleTab === 'blocks' ? 'default' : 'outline'} onClick={() => setActiveTab('blocks')}>
            提示词块库
          </Button>
        </div>
      ) : null}

      {visibleTab === 'scenes' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              按场景分类展示；每个场景只列出相关提示词块，避免把分卡/OCR/做题块混在一起。
            </p>
          </div>
          {SCENE_CATEGORY_ORDER
            .map((category) => {
              const categoryScenes = scenes.filter((scene) => {
                const sceneCategory = scene.category || '其他'
                if (sceneCategory !== category) return false
                return true
              })
              return { category, categoryScenes }
            })
            .filter((group) => group.categoryScenes.length > 0)
            .map(({ category, categoryScenes }) => (
            <div key={category} className="space-y-4">
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">{category}</h2>
              {categoryScenes.map((scene) => {
            const draft = sceneDrafts[scene.scene_key] ?? scene
            const versions = sceneVersions[scene.scene_key] ?? []
            const recommended = new Set(scene.recommended_block_keys ?? [])
            const sceneBlocks = filterBlocksForScene(
              blocks,
              scene.scene_key,
              draft,
              draft.block_keys,
            )
            const blockGroups = groupBlocksByLayer(sceneBlocks)
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
                  {sceneBlocks.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                      本场景使用完整场景提示词，无可勾选模块块。
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {blockGroups.map((group) => (
                        <div key={group.layer} className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.label}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {group.blocks.map((block) => (
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
                                  <span className="block font-medium">
                                    {block.label}
                                    {recommended.has(block.key) ? (
                                      <Badge variant="secondary" className="ml-2 align-middle text-[10px]">推荐</Badge>
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
          ))}
        </div>
      ) : null}

      {visibleTab === 'blocks' ? (
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
