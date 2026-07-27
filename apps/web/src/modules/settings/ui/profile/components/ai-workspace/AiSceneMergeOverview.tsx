import { useEffect, useMemo, useState } from 'react'
import { getAiPromptScenesApi } from '@/modules/settings/domain/preferences-entity/api'
import { mergeAiScenes } from '@/modules/settings/ui/profile/model/ai-scene-merge'
import type { AiPromptSceneDefault, AiSceneBinding } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

const KIND_LABELS = {
  both: '模型 + 提示词',
  'model-only': '仅模型绑定',
  'prompt-only': '仅提示词组合',
} as const

export function AiSceneMergeOverview({ modelScenes }: { modelScenes: AiSceneBinding[] }) {
  const [promptScenes, setPromptScenes] = useState<AiPromptSceneDefault[]>([])

  useEffect(() => {
    void getAiPromptScenesApi()
      .then((response) => setPromptScenes(response.items))
      .catch(() => setPromptScenes([]))
  }, [])

  const merged = useMemo(() => mergeAiScenes(modelScenes, promptScenes), [modelScenes, promptScenes])
  const counts = useMemo(
    () => ({
      both: merged.filter((scene) => scene.kind === 'both').length,
      modelOnly: merged.filter((scene) => scene.kind === 'model-only').length,
      promptOnly: merged.filter((scene) => scene.kind === 'prompt-only').length,
    }),
    [merged],
  )

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">统一场景目录</CardTitle>
        <p className="text-sm text-muted-foreground">
          按 key 外连接模型与提示词 catalog。仅模型场景不会发送提示词保存请求；仅提示词场景跟随通用模型配置。
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">双侧 {counts.both}</Badge>
          <Badge variant="outline">仅模型 {counts.modelOnly}</Badge>
          <Badge variant="outline">仅提示词 {counts.promptOnly}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {merged.map((scene) => (
            <div key={scene.key} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{scene.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{scene.key}</div>
                </div>
                <Badge variant={scene.kind === 'both' ? 'secondary' : 'outline'}>
                  {KIND_LABELS[scene.kind]}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{scene.category}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}