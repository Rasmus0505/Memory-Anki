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
}))

vi.mock('@/features/english-reading/api', () => ({
  getEnglishReadingProfileApi: api.getProfile,
  listEnglishReadingArticlesApi: api.listArticles,
  getEnglishReadingArticleApi: api.getArticle,
  getEnglishReadingDictionaryApi: vi.fn().mockResolvedValue({ lemma: 'learn', phoneticUs: '/lɜːrn/' }),
  createEnglishReadingTargetApi: api.createTarget,
  updateEnglishReadingProfileApi: api.updateProfile,
  createEnglishReadingArticleApi: vi.fn(),
  deleteEnglishReadingArticleApi: vi.fn(),
  deleteEnglishReadingTargetApi: vi.fn(),
  explainEnglishReadingTargetApi: api.explainTarget,
  generateTargetedEnglishReadingArticleApi: vi.fn(),
  renameEnglishReadingArticleApi: vi.fn(),
  updateEnglishReadingTargetApi: vi.fn(),
}))

vi.mock('@/features/english-shell', () => ({
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
      <Routes><Route path="/english/reading/materials/:materialId" element={<EnglishReadingPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('EnglishReadingPage gap loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getProfile.mockResolvedValue({ declaredCefr: 'B1' })
    api.listArticles.mockResolvedValue({ items: [article], tree: [{ ...article, children: [] }] })
    api.getArticle.mockResolvedValue(article)
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
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn(), getVoices: vi.fn(() => []) },
    })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        lang = ''
        voice = null
        text: string
        constructor(text: string) { this.text = text }
      },
    })
  })

  it('renders plain text without legacy CEFR feedback controls', async () => {
    renderPage()
    expect((await screen.findAllByText('A useful article')).length).toBeGreaterThan(0)
    expect(screen.queryByText('本次阅读反馈')).toBeNull()
    expect(screen.queryByText('i+1')).toBeNull()
  })

  it('opens a nearby bubble without auto-creating or queuing a target', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Learning' }))
    expect(await screen.findByTestId('reading-action-bubble')).not.toBeNull()
    expect(await screen.findByText('加入文章')).not.toBeNull()
    expect(window.speechSynthesis.speak).toHaveBeenCalled()
    expect(api.createTarget).not.toHaveBeenCalled()
    expect(screen.getAllByText('Learning').length).toBeGreaterThan(0)
    expect(screen.getByText('还没有加入待生成目标。在气泡里点“加入文章”。')).not.toBeNull()
  })

  it('creates a target only after clicking 加入文章', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Learning' }))
    fireEvent.click(await screen.findByText('加入文章'))
    await waitFor(() => expect(api.createTarget).toHaveBeenCalledWith(1, {
      type: 'word', startOffset: 0, endOffset: 8, quote: 'Learning',
    }))
    expect(await screen.findByText('已加入文章')).not.toBeNull()
  })

  it('keeps CEFR under explicit user control', async () => {
    renderPage()
    const select = await screen.findByDisplayValue('B1')
    fireEvent.change(select, { target: { value: 'B2' } })
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ declaredCefr: 'B2' }))
  })
})
