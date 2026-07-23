import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/modules/content/domain/palace-entity/api'
import {
  fireEvent,
  renderPalaceEditPage,
  renderPalaceEditPageStrict,
  screen,
  setupPalaceEditPageTestDefaults,
  shouldAutoStartOnPageEnterMock,
  timedSessionMock,
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

  it('does not auto start on page enter by default', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: { root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('测试宫殿')).toBeTruthy()
    })

    expect(shouldAutoStartOnPageEnterMock).toHaveBeenCalledWith(expect.anything(), 'palace_edit')
    expect(timedSessionMock.start).not.toHaveBeenCalled()
  })

  it('auto starts on page enter when the action rule is enabled', async () => {
    shouldAutoStartOnPageEnterMock.mockReturnValue(true)
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: { root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('测试宫殿')).toBeTruthy()
    })

    await waitFor(() => {
      expect(timedSessionMock.start).toHaveBeenCalledWith({ source: 'page_enter' })
    })
  })
})
