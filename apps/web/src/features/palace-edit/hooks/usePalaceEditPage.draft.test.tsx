import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/entities/palace/api'
import {
  renderPalaceEditPage,
  renderPalaceEditPageStrict,
  screen,
  setupPalaceEditPageTestDefaults,
  shouldAutoStartOnPageEnterMock,
  timedSessionMock,
  waitFor,
} from '@/features/palace-edit/hooks/usePalaceEditPage.test-support'

describe('usePalaceEditPage draft creation', () => {
  beforeEach(() => {
    setupPalaceEditPageTestDefaults()
  })

  it('creates only one draft palace in StrictMode for /palaces/new', async () => {
    const createPalaceApi = vi.spyOn(palaceApi, 'createPalaceApi').mockResolvedValue({ id: 101 } as never)

    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '未命名宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: { root: { data: { text: '未命名宫殿', uid: 'root-1' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPageStrict()

    await waitFor(() => {
      expect(createPalaceApi).toHaveBeenCalledTimes(1)
    })
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

    expect(shouldAutoStartOnPageEnterMock).toHaveBeenCalled()
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
