import type {
  AiModelScenario,
  AiPromptSceneDefault,
  AiPromptTemplate,
  AiRuntimeOptions,
} from '@/shared/api/contracts'

const RECENT_AI_CONFIG_PREFIX = 'memory-anki.ai-runtime-recent.'

const SCENARIO_PROMPT_TEMPLATE_KEYS = {
  vision_image_mindmap: 'ai_prompt_import_image_mindmap',
  vision_image_text: 'ai_prompt_import_image_text',
  vision_batch_mindmap: 'ai_prompt_import_document_mindmap',
  vision_structure_mindmap: 'ai_prompt_import_batch_mindmap',
  mindmap_ocr_formatter: 'ai_prompt_import_ocr_mindmap_format',
  quiz_image_generation: 'ai_prompt_palace_quiz_generate',
  quiz_text_generation: 'ai_prompt_palace_quiz_generate',
  quiz_review_mindmap_generation: 'ai_prompt_palace_quiz_review_mindmap',
  quiz_mini_palace_grouping: 'ai_prompt_palace_quiz_group_by_mini_palace',
  quiz_node_binding: 'ai_prompt_palace_quiz_node_binding',
} as const satisfies Record<string, AiPromptTemplate['key']>

type ScenarioPromptTemplateKey = keyof typeof SCENARIO_PROMPT_TEMPLATE_KEYS

export interface PromptTemplateSnapshot {
  template: string
  defaultTemplate: string
}

export function getScenarioPromptTemplateKey(scenarioKey: string) {
  return Object.prototype.hasOwnProperty.call(SCENARIO_PROMPT_TEMPLATE_KEYS, scenarioKey)
    ? SCENARIO_PROMPT_TEMPLATE_KEYS[scenarioKey as ScenarioPromptTemplateKey]
    : undefined
}

function recentConfigKey(entrypointKey: string, scenarioKey: string) {
  return `${RECENT_AI_CONFIG_PREFIX}${entrypointKey}.${scenarioKey}`
}

function sanitizeRecentPromptOverride(
  scenarioKey: string,
  promptOverride: string | undefined,
) {
  if (!promptOverride || scenarioKey !== 'vision_batch_mindmap') return promptOverride
  const assumesStructureImage = [
    /第一张(?:被指定为)?结构图/,
    /第一张(?:图片|图像).{0,12}结构图/,
    /其余图片.{0,12}(?:教材)?正文/,
    /基于.{0,12}(?:原始)?导图结构.{0,12}(?:补充|补全)/,
  ].some((pattern) => pattern.test(promptOverride))
  return assumesStructureImage ? undefined : promptOverride
}

export function readRecentAiConfig(
  entrypointKey: string,
  scenarioKey: string,
): AiRuntimeOptions | null {
  if (typeof window === 'undefined') return null
  try {
    const raw =
      window.localStorage.getItem(recentConfigKey(entrypointKey, scenarioKey)) ||
      window.localStorage.getItem(`${RECENT_AI_CONFIG_PREFIX}${entrypointKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AiRuntimeOptions
    if (!parsed || typeof parsed !== 'object') return null
    return {
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : undefined,
      thinking_enabled:
        typeof parsed.thinking_enabled === 'boolean' ? parsed.thinking_enabled : undefined,
      prompt_options:
        parsed.prompt_options && typeof parsed.prompt_options === 'object'
          ? {
              run_instruction:
                typeof parsed.prompt_options.run_instruction === 'string'
                  ? parsed.prompt_options.run_instruction
                  : undefined,
              emphasis_mark_description:
                typeof parsed.prompt_options.emphasis_mark_description === 'string'
                  ? parsed.prompt_options.emphasis_mark_description
                  : undefined,
            }
          : undefined,
    }
  } catch {
    return null
  }
}

export function writeRecentAiConfig(
  entrypointKey: string,
  scenarioKey: string,
  value: AiRuntimeOptions,
) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      recentConfigKey(entrypointKey, scenarioKey),
      JSON.stringify({
        model: value.model,
        thinking_enabled: value.thinking_enabled,
        prompt_options: {
          run_instruction: value.prompt_options?.run_instruction,
          emphasis_mark_description: value.prompt_options?.emphasis_mark_description,
        },
      }),
    )
  } catch {
    // Ignore local storage failures and keep the current run usable.
  }
}

export function buildDefaultAiConfig(
  scenario: AiModelScenario,
  promptTemplate?: PromptTemplateSnapshot | null,
  promptScene?: AiPromptSceneDefault | null,
): AiRuntimeOptions {
  return {
    model: scenario.default_model,
    thinking_enabled: scenario.default_thinking_enabled,
    prompt_override: undefined,
    prompt_options: promptScene
      ? {
          block_keys: promptScene.block_keys,
          scene_instruction: promptScene.scene_instruction,
          run_instruction: '',
          emphasis_mark_description: '',
        }
      : {
          scene_instruction: promptTemplate?.template || promptTemplate?.defaultTemplate || '',
          run_instruction: '',
          emphasis_mark_description: '',
        },
  }
}

export function normalizeScenarioAiConfig(
  scenario: AiModelScenario,
  value: AiRuntimeOptions | null | undefined,
  promptTemplate?: PromptTemplateSnapshot | null,
  promptScene?: AiPromptSceneDefault | null,
): AiRuntimeOptions {
  const fallback = buildDefaultAiConfig(scenario, promptTemplate, promptScene)
  const model = value?.model?.trim()
  const matchedModel = scenario.available_models.find((item) => item.key === model)
  const resolvedModel = matchedModel?.key ?? fallback.model
  const resolvedMetadata = scenario.available_models.find((item) => item.key === resolvedModel)
  return {
    model: resolvedModel,
    thinking_enabled: resolvedMetadata?.supports_thinking
      ? Boolean(value?.thinking_enabled ?? fallback.thinking_enabled)
      : false,
    prompt_override: sanitizeRecentPromptOverride(scenario.key, value?.prompt_override?.trim()),
    prompt_options: {
      block_keys: fallback.prompt_options?.block_keys,
      scene_instruction: fallback.prompt_options?.scene_instruction,
      run_instruction: value?.prompt_options?.run_instruction ?? '',
      emphasis_mark_description: value?.prompt_options?.emphasis_mark_description ?? '',
    },
  }
}
