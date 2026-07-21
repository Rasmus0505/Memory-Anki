import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiRunConfigDialog } from './useAiRunConfigDialog'

const getAiModelScenariosApiMock = vi.fn()
const getAiPromptTemplatesApiMock = vi.fn()
const getAiPromptBlocksApiMock = vi.fn()
const getAiPromptScenesApiMock = vi.fn()
const previewAiPromptCompositionApiMock = vi.fn()
const saveAiPromptSceneDefaultApiMock = vi.fn()

vi.mock('@/entities/preferences/api', () => ({
  getAiModelScenariosApi: () => getAiModelScenariosApiMock(),
  getAiPromptTemplatesApi: () => getAiPromptTemplatesApiMock(),
  getAiPromptBlocksApi: () => getAiPromptBlocksApiMock(),
  getAiPromptScenesApi: () => getAiPromptScenesApiMock(),
  previewAiPromptCompositionApi: (...args: unknown[]) => previewAiPromptCompositionApiMock(...args),
  saveAiPromptSceneDefaultApi: (...args: unknown[]) => saveAiPromptSceneDefaultApiMock(...args),
}))

function TestHarness({
  withContext = false,
  scenarioKey = 'vision_image_text',
  entrypointKey = 'import-image-text',
}: {
  withContext?: boolean
  scenarioKey?: string
  entrypointKey?: string
}) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const [result, setResult] = React.useState('')
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void promptForAiOptions({
            scenarioKey,
            entrypointKey,
            title: '图片转文字配置',
            contextOptions: withContext ? [{
              id: 'mindmap',
              label: '当前思维导图',
              content: '节点 A\n节点 B',
            }] : undefined,
          }).then((value) => setResult(JSON.stringify(value ?? {})))
        }}
      >
        open
      </button>
      <output data-testid="result">{result}</output>
      {aiRunConfigDialog}
    </>
  )
}

describe('useAiRunConfigDialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
    getAiModelScenariosApiMock.mockReset()
    getAiPromptTemplatesApiMock.mockReset()
    getAiPromptBlocksApiMock.mockReset()
    getAiPromptScenesApiMock.mockReset()
    previewAiPromptCompositionApiMock.mockReset()
    saveAiPromptSceneDefaultApiMock.mockReset()
    getAiModelScenariosApiMock.mockResolvedValue({
      scenes: [
        {
          key: 'vision_image_text',
          label: '单图转文字',
          description: 'OCR',
          default_model: 'qwen3.5-ocr',
          default_thinking_enabled: false,
          available_models: [
            {
              key: 'qwen3.5-ocr',
              label: 'Qwen3.5 OCR',
              provider: 'qwen',
              supports_thinking: false,
            },
            {
              key: 'qwen3-vl-flash',
              label: 'Qwen3 VL Flash',
              provider: 'qwen',
              supports_thinking: false,
            },
          ],
        },
        {
          key: 'vision_batch_mindmap',
          label: '教材正文转脑图',
          description: '普通 PDF',
          default_model: 'qwen3-vl-flash',
          default_thinking_enabled: false,
          available_models: [
            {
              key: 'qwen3-vl-flash',
              label: 'Qwen3 VL Flash',
              provider: 'qwen',
              supports_thinking: false,
            },
            {
              key: 'qwen3.5-ocr',
              label: 'Qwen3.5 OCR',
              provider: 'qwen',
              supports_thinking: false,
            },
          ],
        },
      ],
    })
    getAiPromptTemplatesApiMock.mockResolvedValue({
      items: [
        {
          key: 'ai_prompt_import_image_text',
          template: '默认 OCR 提示词',
          default_template: '系统 OCR 提示词',
        },
        {
          key: 'ai_prompt_import_document_mindmap',
          template: '新版正文提示词：不假设结构图，根据全部正文层级生成。',
          default_template: '系统正文提示词',
        },
      ],
    })
    const blocks = [
      {
        key: 'content.literal_ocr',
        label: '逐字识别',
        description: '保留原文',
        layer: 'content',
        sort_order: 10,
        template: '逐字识别并保留原文。',
        is_builtin: true,
        is_active: true,
        applicable_scene_keys: ['vision_image_text'],
        placeholders: [],
        affected_scene_keys: ['vision_image_text'],
      },
      {
        key: 'output.mindmap_json',
        label: '脑图 JSON',
        description: '严格脑图结构',
        layer: 'output',
        sort_order: 10,
        template: '只输出脑图 JSON。',
        is_builtin: true,
        is_active: true,
        applicable_scene_keys: ['vision_batch_mindmap'],
        placeholders: [],
        affected_scene_keys: ['vision_batch_mindmap'],
      },
    ]
    getAiPromptBlocksApiMock.mockResolvedValue({ items: blocks })
    getAiPromptScenesApiMock.mockResolvedValue({
      items: [
        {
          scene_key: 'vision_image_text',
          prompt_key: 'ai_prompt_import_image_text',
          label: '单图转文字',
          description: 'OCR',
          block_keys: ['content.literal_ocr'],
          blocks: [blocks[0]],
          scene_instruction: '服务器 OCR 默认要求',
          active_version_id: 'scene-ocr-v1',
          source: 'builtin',
          recommended_block_keys: ['content.literal_ocr'],
          compiled_prompt: '逐字识别并保留原文。\n\n服务器 OCR 默认要求',
          warnings: [],
          estimated_tokens: 20,
        },
        {
          scene_key: 'vision_batch_mindmap',
          prompt_key: 'ai_prompt_import_document_mindmap',
          label: '教材正文转脑图',
          description: '普通 PDF',
          block_keys: ['output.mindmap_json'],
          blocks: [blocks[1]],
          scene_instruction: '根据全部正文层级生成，不假设结构图。',
          active_version_id: 'scene-mindmap-v1',
          source: 'builtin',
          recommended_block_keys: ['output.mindmap_json'],
          compiled_prompt: '只输出脑图 JSON。\n\n根据全部正文层级生成，不假设结构图。',
          warnings: [],
          estimated_tokens: 20,
        },
      ],
    })
    previewAiPromptCompositionApiMock.mockImplementation((sceneKey, selection) => Promise.resolve({
      scene_key: sceneKey,
      prompt_key: 'prompt-key',
      text: [
        ...(selection.block_keys ?? []).map((key: string) => blocks.find((item) => item.key === key)?.template ?? ''),
        selection.scene_instruction ?? '',
        selection.run_instruction ? `本次运行追加要求：\n${selection.run_instruction}` : '',
      ].filter(Boolean).join('\n\n'),
      block_keys: selection.block_keys ?? [],
      block_versions: {},
      scene_instruction: selection.scene_instruction ?? '',
      run_instruction: selection.run_instruction ?? '',
      warnings: [],
      estimated_tokens: 20,
    }))
    saveAiPromptSceneDefaultApiMock.mockImplementation((sceneKey, selection) => Promise.resolve({
      scene_key: sceneKey,
      prompt_key: 'prompt-key',
      label: '单图转文字',
      description: 'OCR',
      block_keys: selection.block_keys ?? [],
      blocks: [],
      scene_instruction: selection.scene_instruction ?? '',
      active_version_id: 'scene-v2',
      source: 'user',
      recommended_block_keys: [],
      compiled_prompt: '',
      warnings: [],
      estimated_tokens: 20,
    }))
  })

  it('uses the server scene default and never restores a cached full prompt', async () => {
    window.localStorage.setItem(
      'memory-anki.ai-runtime-recent.import-image-text.vision_image_text',
      JSON.stringify({ model: 'qwen3-vl-flash', prompt_override: '陈旧完整提示词' }),
    )
    render(<TestHarness />)

    fireEvent.click(screen.getByText('open'))
    expect((await screen.findByLabelText('场景特殊提示词') as HTMLTextAreaElement).value).toBe('服务器 OCR 默认要求')
    expect((screen.getByLabelText('完整覆盖提示词') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('本次模型') as HTMLSelectElement).value).toBe('qwen3-vl-flash')
    const ocrCheckbox = screen.getByRole('checkbox', { name: /逐字识别/ }) as HTMLInputElement
    expect(ocrCheckbox.checked).toBe(true)
    expect(screen.queryByRole('checkbox', { name: /脑图 JSON/ })).toBeNull()
    fireEvent.click(screen.getByText('开始生成'))
    await waitFor(() => expect(screen.getByTestId('result').textContent).toContain('服务器 OCR 默认要求'))
    expect(window.localStorage.getItem('memory-anki.ai-runtime-recent.import-image-text.vision_image_text')).not.toContain('prompt_override')
  })

  it('checks PDF mindmap default blocks and hides unrelated prompt blocks', async () => {
    render(
      <TestHarness
        scenarioKey={'vision_batch_mindmap'}
        entrypointKey={'import-pdf-mindmap'}
      />,
    )

    fireEvent.click(screen.getByText('open'))
    const mindmapCheckbox = await screen.findByRole('checkbox', { name: /脑图 JSON/ }) as HTMLInputElement
    expect(mindmapCheckbox.checked).toBe(true)
    expect(screen.queryByRole('checkbox', { name: /逐字识别/ })).toBeNull()
    expect(screen.getByText(/已选 1\/1/)).toBeTruthy()
  })

  it('keeps optional context unchecked until selected and snapshots it into the prompt', async () => {
    render(<TestHarness withContext />)

    fireEvent.click(screen.getByText('open'))
    const contextCheckbox = await screen.findByRole('checkbox', { name: /当前思维导图/ })
    expect((contextCheckbox as HTMLInputElement).checked).toBe(false)
    fireEvent.click(contextCheckbox)
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => expect(screen.getByTestId('result').textContent).toContain('只读上下文快照'))
    expect(screen.getByTestId('result').textContent).toContain('节点 A')
    expect(screen.getByTestId('result').textContent).toContain('run_instruction')

    fireEvent.click(screen.getByText('open'))
    const reopenedCheckbox = await screen.findByRole('checkbox', { name: /当前思维导图/ })
    expect((reopenedCheckbox as HTMLInputElement).checked).toBe(false)
  })

  it('discards a cached structure-image prompt for ordinary PDF while preserving the model', async () => {
    window.localStorage.setItem(
      'memory-anki.ai-runtime-recent.import-pdf-mindmap.vision_batch_mindmap',
      JSON.stringify({
        model: 'qwen3.5-ocr',
        thinking_enabled: false,
        prompt_override:
          '任务：第一张图片是结构图，其余图片提供教材正文，基于原始导图结构补全内容。',
      }),
    )
    render(
      <TestHarness
        scenarioKey={'vision_batch_mindmap'}
        entrypointKey={'import-pdf-mindmap'}
      />,
    )

    fireEvent.click(screen.getByText('open'))
    expect((await screen.findByLabelText('场景特殊提示词') as HTMLTextAreaElement).value).toBe(
      '根据全部正文层级生成，不假设结构图。',
    )
    expect((screen.getByLabelText('完整覆盖提示词') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('本次模型') as HTMLSelectElement).value).toBe('qwen3.5-ocr')
  })

  it('saves block selection and scene instruction as the future default only', async () => {
    render(<TestHarness />)
    fireEvent.click(screen.getByText('open'))
    fireEvent.change(await screen.findByLabelText('场景特殊提示词'), { target: { value: '新的场景默认' } })
    fireEvent.change(screen.getByLabelText('本次运行追加要求'), { target: { value: '只用于本次' } })
    fireEvent.click(screen.getByRole('button', { name: '设为以后默认' }))
    await waitFor(() => expect(saveAiPromptSceneDefaultApiMock).toHaveBeenCalled())
    expect(saveAiPromptSceneDefaultApiMock).toHaveBeenCalledWith(
      'vision_image_text',
      {
        block_keys: ['content.literal_ocr'],
        scene_instruction: '新的场景默认',
      },
    )
  })

  it('blocks execution when the selected context exceeds the safe token budget', async () => {
    function LargeContextHarness() {
      const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
      return (
        <>
          <button
            type="button"
            onClick={() => {
              void promptForAiOptions({
                scenarioKey: 'vision_image_text',
                entrypointKey: 'large-context',
                title: '大上下文配置',
                contextOptions: [{ id: 'quiz', label: '当前题库', content: '题'.repeat(40000) }],
              })
            }}
          >
            large
          </button>
          {aiRunConfigDialog}
        </>
      )
    }
    render(<LargeContextHarness />)

    fireEvent.click(screen.getByText('large'))
    fireEvent.click(await screen.findByRole('checkbox', { name: /当前题库/ }))
    expect(screen.getByText(/超过 24000 Token 安全预算/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
