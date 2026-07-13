import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiRunConfigDialog } from './useAiRunConfigDialog'

const getAiModelScenariosApiMock = vi.fn()
const getAiPromptTemplatesApiMock = vi.fn()

vi.mock('@/entities/preferences/api', () => ({
  getAiModelScenariosApi: () => getAiModelScenariosApiMock(),
  getAiPromptTemplatesApi: () => getAiPromptTemplatesApiMock(),
}))

function TestHarness({ withContext = false }: { withContext?: boolean }) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const [result, setResult] = React.useState('')
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void promptForAiOptions({
            scenarioKey: 'vision_image_text',
            entrypointKey: 'import-image-text',
            title: '图片转文字配置',
            contextOptions: withContext ? [{
              id: 'mindmap',
              label: '当前思维导图',
              content: '节点 A\n节点 B',
            }] : undefined,
          }).then((value) => setResult(value?.prompt_override ?? ''))
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
      ],
    })
    getAiPromptTemplatesApiMock.mockResolvedValue({
      items: [
        {
          key: 'ai_prompt_import_image_text',
          template: '默认 OCR 提示词',
          default_template: '系统 OCR 提示词',
        },
      ],
    })
  })

  it('persists prompt overrides for the next run and resets to the scenario default', async () => {
    render(<TestHarness />)

    fireEvent.click(screen.getByText('open'))
    const promptBox = await screen.findByLabelText('本次提示词')
    expect((promptBox as HTMLTextAreaElement).value).toBe('默认 OCR 提示词')

    fireEvent.change(promptBox, { target: { value: '只输出原文，不要解释' } })
    fireEvent.change(screen.getByLabelText('本次模型'), { target: { value: 'qwen3-vl-flash' } })
    fireEvent.click(screen.getByText('开始生成'))
    await waitFor(() => expect(screen.queryByText('图片转文字配置')).toBeNull())

    fireEvent.click(screen.getByText('open'))
    const persistedPromptBox = await screen.findByLabelText('本次提示词')
    expect((persistedPromptBox as HTMLTextAreaElement).value).toBe('只输出原文，不要解释')
    expect((screen.getByLabelText('本次模型') as HTMLSelectElement).value).toBe('qwen3-vl-flash')

    fireEvent.click(screen.getByText('重置默认'))
    expect((persistedPromptBox as HTMLTextAreaElement).value).toBe('默认 OCR 提示词')
    expect((screen.getByLabelText('本次模型') as HTMLSelectElement).value).toBe('qwen3.5-ocr')
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

    fireEvent.click(screen.getByText('open'))
    const reopenedCheckbox = await screen.findByRole('checkbox', { name: /当前思维导图/ })
    expect((reopenedCheckbox as HTMLInputElement).checked).toBe(false)
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
