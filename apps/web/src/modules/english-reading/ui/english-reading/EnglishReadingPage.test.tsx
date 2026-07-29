import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EnglishReadingPage from './EnglishReadingPage'

const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listArticles: vi.fn(),
  getArticle: vi.fn(),
  createTarget: vi.fn(),
  updateProfile: vi.fn(),
  explainTarget: vi.fn(),
  searchLookup: vi.fn(),
}))

vi.mock('@/modules/english-reading/ui/english-reading/api', () => ({
  getEnglishReadingProfileApi: api.getProfile,
  listEnglishReadingArticlesApi: api.listArticles,
  getEnglishReadingArticleApi: api.getArticle,
  createEnglishReadingTargetApi: api.createTarget,
  updateEnglishReadingProfileApi: api.updateProfile,
  createEnglishReadingArticleApi: vi.fn(),
  createEnglishReadingVocabularyNoteApi: vi.fn(),
  deleteEnglishReadingArticleApi: vi.fn(),
  deleteEnglishReadingTargetApi: vi.fn(),
  explainEnglishReadingTargetApi: api.explainTarget,
  generateTargetedEnglishReadingArticleApi: vi.fn(),
  renameEnglishReadingArticleApi: vi.fn(),
  updateEnglishReadingTargetApi: vi.fn(),
}))

vi.mock('@/modules/english-lookup/public', async () => {
  const actual = await vi.importActual<typeof import('@/modules/english-lookup/public')>(
    '@/modules/english-lookup/public',
  )
  return {
    ...actual,
    searchEnglishLookupApi: api.searchLookup,
  }
})

vi.mock('@/modules/english-lookup/api', () => ({
  searchEnglishLookupApi: (...args: unknown[]) => api.searchLookup(...args),
}))

vi.mock('@/modules/english/ui/english-shell', () => ({
  EnglishZoneLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/modules/english/public', () => ({
  EnglishZoneLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const article = {
  id: 1,
  title: 'A useful article',
  kind: 'source' as const,
  sourceType: 'paste',
  originalFilename: '',
  wordCount: 4,
  depth: 0,
  parentArticleId: null,
  generationConfig: {},
  createdAt: null,
  updatedAt: null,
  content: 'Learning through context works.',
  targets: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/english/reading/materials/1']}>
      <Routes>
        <Route path="/english/reading/materials/:materialId" element={<EnglishReadingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EnglishReadingPage lookup cleanup', () => {
  beforeEach(() => {
    api.getProfile.mockResolvedValue({ declaredCefr: 'B1' })
    api.listArticles.mockResolvedValue({ items: [], tree: [] })
    api.getArticle.mockResolvedValue(article)
    api.updateProfile.mockResolvedValue({ declaredCefr: 'B2' })
    api.searchLookup.mockResolvedValue({
      query: 'Learning',
      wordCount: 1,
      vocabulary: {
        status: 'ok',
        short: 'short def',
        long: 'long def',
        error: null,
        sourceUrl: 'https://www.vocabulary.com/dictionary/Learning',
      },
      cambridge: {
        status: 'ok',
        entries: [{ id: 'e0', html: '<div>cam</div>' }],
        audio: { us: 'https://a/us.mp3', uk: null },
        error: null,
        sourceUrl: null,
      },
      audio: { us: 'https://a/us.mp3', uk: null },
      google: {
        status: 'ok',
        translation: '示例',
        detectedLanguage: 'en',
        error: null,
        sourceUrl: null,
      },
      sourceUrls: { vocabulary: null, cambridge: null, google: null },
    })
    api.createTarget.mockImplementation(async (_articleId, payload) => ({
      id: 9,
      articleId: 1,
      type: payload.type,
      startOffset: payload.startOffset,
      endOffset: payload.endOffset,
      quote: payload.quote,
      normalizedValue: payload.quote.toLowerCase(),
      priority: 1,
      explanations: [],
      linkedArticles: [],
    }))
  })

  it('renders plain text without legacy CEFR feedback controls', async () => {
    renderPage()
    expect((await screen.findAllByText('A useful article')).length).toBeGreaterThan(0)
    expect(screen.queryByText('本次阅读反馈')).toBeNull()
    expect(screen.queryByText('i+1')).toBeNull()
  })

  it('word click opens Saladict lookup only (no legacy bubble / no TTS)', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Learning' }))
    expect(screen.queryByTestId('reading-action-bubble')).toBeNull()
    expect(screen.queryByText('加入文章')).toBeNull()
    expect(screen.queryByTestId('dictionary-popup-panel')).toBeNull()
    await waitFor(() => expect(api.searchLookup).toHaveBeenCalled())
    expect(await screen.findByTestId('english-lookup-panel')).not.toBeNull()
    expect(api.createTarget).not.toHaveBeenCalled()
  })

  it('keeps CEFR under explicit user control', async () => {
    renderPage()
    const select = await screen.findByDisplayValue('B1')
    fireEvent.change(select, { target: { value: 'B2' } })
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ declaredCefr: 'B2' }))
  })
})
