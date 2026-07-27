import type { AiPromptSceneDefault, AiSceneBinding } from '@/shared/api/contracts'

export type MergedSceneKind = 'both' | 'model-only' | 'prompt-only'

export interface MergedAiScene {
  key: string
  label: string
  category: string
  kind: MergedSceneKind
  modelScene: AiSceneBinding | null
  promptScene: AiPromptSceneDefault | null
}

export function mergeAiScenes(
  modelScenes: AiSceneBinding[],
  promptScenes: AiPromptSceneDefault[],
): MergedAiScene[] {
  const visiblePromptScenes = promptScenes.filter((scene) => !scene.is_compatibility)
  const modelByKey = new Map(modelScenes.map((scene) => [scene.key, scene]))
  const promptByKey = new Map(visiblePromptScenes.map((scene) => [scene.scene_key, scene]))
  const keys = new Set([...modelByKey.keys(), ...promptByKey.keys()])

  return [...keys]
    .map((key) => {
      const modelScene = modelByKey.get(key) ?? null
      const promptScene = promptByKey.get(key) ?? null
      return {
        key,
        label: promptScene?.label || modelScene?.label || key,
        category: promptScene?.category || modelScene?.category_label || '未分类',
        kind: modelScene && promptScene ? 'both' : modelScene ? 'model-only' : 'prompt-only',
        modelScene,
        promptScene,
      } satisfies MergedAiScene
    })
    .sort((left, right) => left.category.localeCompare(right.category, 'zh-CN') || left.label.localeCompare(right.label, 'zh-CN'))
}