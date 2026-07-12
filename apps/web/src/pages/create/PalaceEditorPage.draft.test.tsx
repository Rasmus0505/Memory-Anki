import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/entities/palace/api'
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

    expect(await screen.findByText('创建空白宫殿')).toBeTruthy()
    expect(createPalaceApi).not.toHaveBeenCalled()
  })

  it('creates a palace only after the explicit blank-palace action', async () => {
    const createPalaceApi = vi.spyOn(palaceApi, 'createPalaceApi').mockResolvedValue({ id: 101 } as never)

    renderPalaceEditPage('/palaces/new')
    fireEvent.click(screen.getByRole('button', { name: '创建空白宫殿' }))

    await waitFor(() => expect(createPalaceApi).toHaveBeenCalledTimes(1))
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
