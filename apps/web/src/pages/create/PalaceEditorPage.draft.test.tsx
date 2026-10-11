import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/modules/content/domain/palace-entity/api'
import {
  fireEvent,
  renderPalaceEditPage,
  renderPalaceEditPageStrict,
  screen,
  setupPalaceEditPageTestDefaults,
  waitFor,
} from '@/pages/create/PalaceEditorPage.test-support'

describe('usePalaceEditPage draft creation', () => {
  beforeEach(() => {
    setupPalaceEditPageTestDefaults()
  })

  it('does not create a palace merely by opening /palaces/new', async () => {
    const createPalaceApi = vi.spyOn(palaceApi, 'createPalaceApi').mockResolvedValue({ id: 101 } as never)

    renderPalaceEditPageStrict()

    expect(await screen.findByText('创建宫殿')).toBeTruthy()
    expect(createPalaceApi).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '管理学科思维导图' }).getAttribute('href')).toBe('/knowledge')
    expect(
      (await screen.findByRole('link', { name: '编辑学科思维导图 测试学科' })).getAttribute('href'),
    ).toBe('/knowledge?subjectId=1')
  })

  it('creates a palace only after title and subject are selected', async () => {
    const createPalaceApi = vi.spyOn(palaceApi, 'createPalaceApi').mockResolvedValue({ id: 101 } as never)

    renderPalaceEditPage('/palaces/new')
    fireEvent.change(screen.getByLabelText('宫殿名'), { target: { value: '教育史宫殿' } })
    fireEvent.click(await screen.findByTestId('select-subject-1'))
    const createButton = await screen.findByRole('button', { name: '创建并进入编辑器' })
    await waitFor(() => expect((createButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(createButton)

    await waitFor(() =>
      expect(createPalaceApi).toHaveBeenCalledWith(
        expect.objectContaining({ title: '教育史宫殿', subject_ids: [1] }),
      ),
    )
  })
})
