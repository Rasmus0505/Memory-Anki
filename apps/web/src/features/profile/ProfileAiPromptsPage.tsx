import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Save, WandSparkles } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import type { AiPromptTemplate } from '@/shared/api/contracts'
import {
  getAiPromptTemplatesApi,
  resetAiPromptTemplatesApi,
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
  const [items, setItems] = useState<AiPromptTemplate[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [resettingKeys, setResettingKeys] = useState<Record<string, boolean>>({})
  const [resettingAll, setResettingAll] = useState(false)

  useEffect(() => {
    const load = async () => {
      const response = await getAiPromptTemplatesApi()
      setItems(response.items)
      setDrafts(buildDraftMap(response.items))
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
      toast.success(`${item.label} 已保存`)
    } finally {
      setSavingKeys((current) => ({ ...current, [item.key]: false }))
    }
  }

  const handleResetOne = async (item: AiPromptTemplate) => {
    setResettingKeys((current) => ({ ...current, [item.key]: true }))
    try {
      const response = await resetAiPromptTemplatesApi([item.key])
      syncItems(response.items)
      toast.success(`${item.label} 已恢复默认`)
    } finally {
      setResettingKeys((current) => ({ ...current, [item.key]: false }))
    }
  }

  const handleResetAll = async () => {
    setResettingAll(true)
    try {
      const response = await resetAiPromptTemplatesApi()
      syncItems(response.items)
      toast.success('全部 AI 提示词已恢复默认')
    } finally {
      setResettingAll(false)
    }
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
                    {isSaving ? '保存中...' : '保存'}
                  </Button>
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
    </div>
  )

  if (standalone) {
    return (
      <ProfileLayout
        title="AI 提示词"
        description="这里可以查看和编辑所有外部 AI 能力的预设提示词。保存后会立刻作用于后续识别与 AI 知识点拆分请求，恢复默认会删除自定义覆盖值。"
      >
        {content}
      </ProfileLayout>
    )
  }

  return content
}

export default ProfileAiPromptsPage
