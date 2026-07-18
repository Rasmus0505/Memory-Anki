import type {
  AiPromptBlock,
  AiPromptLayer,
  AiPromptRunSelection,
  AiPromptSceneDefault,
} from '@/shared/api/contracts'

export interface AiGenerationContextOption {
  id: 'mindmap' | 'quiz' | string
  label: string
  description?: string
  content: string
}

export const PROMPT_LAYER_LABELS: Record<AiPromptLayer, string> = {
  role: '角色',
  task: '任务',
  content: '内容规则',
  boundary: '边界',
  output: '输出格式',
  quality: '质量自检',
}

export const PROMPT_LAYER_DISPLAY_ORDER: AiPromptLayer[] = [
  'role',
  'task',
  'content',
  'boundary',
  'output',
  'quality',
]

/** Resolve modular default block keys; never leave a scene with an empty combination when catalog has defaults. */
export function resolveDefaultBlockKeys(
  promptScene?: Pick<AiPromptSceneDefault, 'block_keys' | 'recommended_block_keys'> | null,
) {
  const selected = promptScene?.block_keys ?? []
  if (selected.length > 0) return [...selected]
  const recommended = promptScene?.recommended_block_keys ?? []
  return recommended.length > 0 ? [...recommended] : []
}

/**
 * Only show blocks that belong to the current scene.
 * Unscoped legacy blocks appear only if already selected or part of the scene default.
 */
export function filterBlocksForScene(
  blocks: AiPromptBlock[],
  sceneKey: string,
  promptScene?: Pick<AiPromptSceneDefault, 'block_keys' | 'recommended_block_keys'> | null,
  selectedBlockKeys: string[] = [],
) {
  const defaultKeys = new Set([
    ...(promptScene?.block_keys ?? []),
    ...(promptScene?.recommended_block_keys ?? []),
    ...selectedBlockKeys,
  ])
  return blocks
    .filter((block) => {
      if (!block.is_active) return false
      if (block.applicable_scene_keys.length > 0) {
        return (
          block.applicable_scene_keys.includes(sceneKey)
          || selectedBlockKeys.includes(block.key)
        )
      }
      // Empty applicable_scene_keys used to mean "all scenes"; treat as scene-local only.
      return defaultKeys.has(block.key)
    })
    .sort((left, right) => (
      PROMPT_LAYER_ORDER[left.layer] - PROMPT_LAYER_ORDER[right.layer]
      || left.sort_order - right.sort_order
      || left.key.localeCompare(right.key)
    ))
}

export function groupBlocksByLayer(blocks: AiPromptBlock[]) {
  const groups: Array<{ layer: AiPromptLayer; label: string; blocks: AiPromptBlock[] }> = []
  for (const layer of PROMPT_LAYER_DISPLAY_ORDER) {
    const layerBlocks = blocks.filter((block) => block.layer === layer)
    if (layerBlocks.length === 0) continue
    groups.push({
      layer,
      label: PROMPT_LAYER_LABELS[layer],
      blocks: layerBlocks,
    })
  }
  return groups
}

export interface AiRunConfigRequest {
  scenarioKey: string
  entrypointKey: string
  title: string
  description?: string
  promptSceneKey?: string
  syncScenarioKeys?: string[]
  contextOptions?: AiGenerationContextOption[]
}

export interface MultiScenarioEntry {
  scenarioKey: string
  entrypointKey: string
  label?: string
  description?: string
  promptSceneKey?: string
  syncScenarioKeys?: string[]
  contextOptions?: AiGenerationContextOption[]
}

export interface MultiAiRunConfigRequest {
  title: string
  description?: string
  entries: MultiScenarioEntry[]
}

export function buildPromptWithContexts(
  prompt: string,
  options: AiGenerationContextOption[],
  selectedIds: string[],
) {
  const selected = options.filter((item) => selectedIds.includes(item.id) && item.content.trim())
  if (selected.length === 0) return prompt
  const contextText = selected
    .map((item) => `【${item.label}】\n${item.content.trim()}`)
    .join('\n\n')
  return `${prompt.trim()}\n\n以下内容是本次运行额外的只读上下文快照：\n${contextText}`.trim()
}

export const PROMPT_LAYER_ORDER: Record<AiPromptLayer, number> = {
  role: 10,
  task: 20,
  content: 30,
  boundary: 40,
  output: 50,
  quality: 60,
}

export function compileLocalPromptPreview(
  blocks: AiPromptBlock[],
  selection: AiPromptRunSelection,
  recommendedBlockKeys: string[],
) {
  const selectedKeys = selection.block_keys ?? []
  const selectedBlocks = blocks
    .filter((block) => selectedKeys.includes(block.key))
    .sort((left, right) => (
      PROMPT_LAYER_ORDER[left.layer] - PROMPT_LAYER_ORDER[right.layer]
      || left.sort_order - right.sort_order
      || left.key.localeCompare(right.key)
    ))
  const parts = selectedBlocks.map((block) => block.template.trim()).filter(Boolean)
  if (selection.scene_instruction?.trim()) parts.push(selection.scene_instruction.trim())
  const emphasis = selection.emphasis_mark_description?.trim()
  if (emphasis) {
    parts.push(
      `重点标记线索：用户要求识别图中（${emphasis}）的文字作为知识重点。`
      + '请仅将这些原文片段写入对应节点的 emphasis_marks，'
      + '格式为 [{"kind":"highlight","text":"原文子串"}]；'
      + '节点 text 保持纯文本；emphasis_marks.text 必须是节点 text 的子串。'
      + '产品侧会渲染为黄色底色。',
    )
  }
  if (selection.run_instruction?.trim()) {
    parts.push(`本次运行追加要求：\n${selection.run_instruction.trim()}`)
  }
  const text = parts.join('\n\n')
  const warnings = recommendedBlockKeys
    .filter((key) => !selectedKeys.includes(key))
    .map((key) => `已取消推荐提示词块：${key}`)
  if (!text.trim()) warnings.push('最终提示词为空。')
  if (/第一张(?:图片|图像).{0,12}结构图/.test(text) && !text.includes('显式')) {
    warnings.push('检测到未声明的“第一张图是结构图”假设。')
  }
  if (text.includes('不要总结') && /(概括|精简|简洁)/.test(text)) {
    warnings.push('检测到“禁止总结”与“概括/精简”可能冲突。')
  }
  return { text, warnings }
}

export function resolvePromptSceneKey(scenarioKey: string, promptSceneKey?: string) {
  return promptSceneKey ?? scenarioKey
}

/** Scenarios that support user-filled textbook emphasis mark clues. */
export const MINDMAP_EMPHASIS_SCENARIO_KEYS = new Set([
  'vision_image_mindmap',
  'vision_batch_mindmap',
  'vision_structure_mindmap',
  'mindmap_ocr_formatter',
])

export function supportsEmphasisMarkDescription(scenarioKey: string) {
  return MINDMAP_EMPHASIS_SCENARIO_KEYS.has(scenarioKey)
}
