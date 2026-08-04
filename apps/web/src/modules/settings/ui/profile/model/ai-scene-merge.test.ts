import { describe, expect, it } from 'vitest'
import type { AiPromptSceneDefault, AiSceneBinding } from '@/shared/api/contracts'
import { mergeAiScenes } from './ai-scene-merge'

const modelScene = { key: 'both', label: '模型场景', category_label: 'LLM' } as AiSceneBinding
const promptScene = { scene_key: 'both', label: '提示词场景', category: '做题' } as AiPromptSceneDefault

describe('mergeAiScenes', () => {
  it('uses an outer join and reports all three states', () => {
    const result = mergeAiScenes(
      [modelScene, { ...modelScene, key: 'model-only' }],
      [promptScene, { ...promptScene, scene_key: 'prompt-only' }],
    )
    expect(Object.fromEntries(result.map((scene) => [scene.key, scene.kind]))).toEqual({
      both: 'both',
      'model-only': 'model-only',
      'prompt-only': 'prompt-only',
    })
  })

})
