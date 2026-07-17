import type {
  AiPromptBlock,
  AiPromptRunSelection,
} from '@/shared/api/contracts'

export interface AiGenerationContextOption {
  id: 'mindmap' | 'quiz' | string
  label: string
  description?: string
  content: string
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

const PROMPT_LAYER_ORDER: Record<AiPromptBlock['layer'], number> = {
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
