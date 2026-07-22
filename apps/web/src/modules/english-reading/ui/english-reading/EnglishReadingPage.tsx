import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, ChevronRight, FilePlus2, LoaderCircle, Sparkles, Trash2, Volume2, X } from 'lucide-react'
import { EnglishZoneLayout } from '@/modules/english/public'
import {
  DEFAULT_READING_GENERATION_CONFIG,
  sentenceBounds,
  toggleReadingTarget,
} from '@/modules/english-reading/domain/gapLoop'
import {
  createEnglishReadingArticleApi,
  createEnglishReadingTargetApi,
  deleteEnglishReadingArticleApi,
  deleteEnglishReadingTargetApi,
  explainEnglishReadingTargetApi,
  generateTargetedEnglishReadingArticleApi,
  getEnglishReadingDictionaryApi,
  getEnglishReadingArticleApi,
  getEnglishReadingProfileApi,
  listEnglishReadingArticlesApi,
  renameEnglishReadingArticleApi,
  updateEnglishReadingProfileApi,
  updateEnglishReadingTargetApi,
} from '@/modules/english-reading/ui/english-reading/api'
import { toast } from '@/shared/feedback/toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import type {
  CefrLevel,
  ReadingArticle,
  ReadingArticleGenerationConfig,
  ReadingArticleTreeItem,
  ReadingDictionaryEntry,
  ReadingExplanation,
  ReadingTarget,
} from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const WORD_PATTERN = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g
const BUBBLE_WIDTH = 320
const BUBBLE_MARGIN = 12

type SelectionBubble = {
  type: 'word' | 'sentence'
  quote: string
  startOffset: number
  endOffset: number
  left: number
  top: number
  targetId: number | null
  dictionary: ReadingDictionaryEntry | null
}

function operationId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function speakAmerican(text: string) {
  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) return
  window.speechSynthesis.cancel()
  const utterance = new window.SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith('en-us'))
  if (voice) utterance.voice = voice
  window.speechSynthesis.speak(utterance)
}

function resolveBubblePosition(rect: DOMRect) {
  const width = Math.min(BUBBLE_WIDTH, window.innerWidth - BUBBLE_MARGIN * 2)
  const preferredLeft = rect.left + rect.width / 2 - width / 2
  const left = Math.min(
    Math.max(BUBBLE_MARGIN, preferredLeft),
    Math.max(BUBBLE_MARGIN, window.innerWidth - width - BUBBLE_MARGIN),
  )
  const spaceBelow = window.innerHeight - rect.bottom - BUBBLE_MARGIN
  const top =
    spaceBelow >= 180
      ? rect.bottom + 10
      : Math.max(BUBBLE_MARGIN, rect.top - 10 - 180)
  return { left, top, width }
}

export default function EnglishReadingPage() {
  const navigate = useNavigate()
  const { materialId } = useParams()
  const articleId = Number(materialId || 0)
  const readerRef = useRef<HTMLDivElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [article, setArticle] = useState<ReadingArticle | null>(null)
  const [tree, setTree] = useState<ReadingArticleTreeItem[]>([])
  const [level, setLevel] = useState<CefrLevel>('B1')
  const [pasteText, setPasteText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [bubble, setBubble] = useState<SelectionBubble | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [busy, setBusy] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [config, setConfig] = useState<ReadingArticleGenerationConfig>(DEFAULT_READING_GENERATION_CONFIG)

  const refreshTree = useCallback(async () => {
    const response = await listEnglishReadingArticlesApi()
    setTree(response.tree)
  }, [])

  const refreshArticle = useCallback(async (id: number) => {
    const response = await getEnglishReadingArticleApi(id)
    setArticle(response)
    return response
  }, [])

  useEffect(() => {
    void Promise.all([getEnglishReadingProfileApi(), listEnglishReadingArticlesApi()]).then(([profile, articles]) => {
      setLevel(profile.declaredCefr)
      setConfig((current) => ({ ...current, cefr: profile.declaredCefr }))
      setTree(articles.tree)
      if (!articleId && articles.items[0]) navigate(`/english/reading/materials/${articles.items[0].id}`, { replace: true })
    })
  }, [articleId, navigate])

  useEffect(() => {
    if (!articleId) {
      setArticle(null)
      setBubble(null)
      setSelectedIds([])
      return
    }
    setBubble(null)
    setSelectedIds([])
    void refreshArticle(articleId).catch((error) => toast.error(error instanceof Error ? error.message : '加载文章失败'))
  }, [articleId, refreshArticle])

  useEffect(() => {
    if (!bubble) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (bubbleRef.current?.contains(target)) return
      if (target instanceof HTMLElement && target.closest('[data-reading-word="true"]')) return
      setBubble(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBubble(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [bubble])

  const activeTarget = useMemo(() => {
    if (!article || bubble?.targetId == null) return null
    return article.targets.find((target) => target.id === bubble.targetId) ?? null
  }, [article, bubble?.targetId])

  const queuedTargets = useMemo(() => {
    if (!article) return []
    return selectedIds
      .map((id) => article.targets.find((target) => target.id === id))
      .filter((target): target is ReadingTarget => Boolean(target))
  }, [article, selectedIds])

  const persistTarget = useCallback(async (input: { type: 'word' | 'sentence'; startOffset: number; endOffset: number; quote: string }) => {
    if (!article) return null
    const existing = article.targets.find((target) => target.type === input.type && target.startOffset === input.startOffset && target.endOffset === input.endOffset)
    if (existing) return existing
    const created = await createEnglishReadingTargetApi(article.id, input)
    setArticle((current) => current ? { ...current, targets: [...current.targets, created].sort((a, b) => a.startOffset - b.startOffset) } : current)
    return created
  }, [article])

  const openBubble = useCallback((
    input: Omit<SelectionBubble, 'dictionary' | 'left' | 'top'> & { rect: DOMRect },
  ) => {
    const position = resolveBubblePosition(input.rect)
    setBubble({
      type: input.type,
      quote: input.quote,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      targetId: input.targetId,
      left: position.left,
      top: position.top,
      dictionary: null,
    })
  }, [])

  const handleWord = useCallback(async (
    word: string,
    startOffset: number,
    endOffset: number,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    speakAmerican(word)
    const rect = event.currentTarget.getBoundingClientRect()
    const existing = article?.targets.find((target) => (
      target.type === 'word'
      && target.startOffset === startOffset
      && target.endOffset === endOffset
    )) ?? article?.targets.find((target) => (
      target.linkedArticles.length > 0
      && startOffset >= target.startOffset
      && endOffset <= target.endOffset
    )) ?? null

    openBubble({
      type: 'word',
      quote: word,
      startOffset,
      endOffset,
      targetId: existing?.id ?? null,
      rect,
    })

    try {
      const dictionary = await getEnglishReadingDictionaryApi(word)
      setBubble((current) => (
        current
        && current.type === 'word'
        && current.startOffset === startOffset
        && current.endOffset === endOffset
          ? { ...current, dictionary }
          : current
      ))
    } catch {
      // dictionary is optional enrichment
    }
  }, [article, openBubble])

  const handleSelection = useCallback(async () => {
    if (!article || !readerRef.current) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!readerRef.current.contains(range.commonAncestorContainer)) return
    const before = range.cloneRange()
    before.selectNodeContents(readerRef.current)
    before.setEnd(range.startContainer, range.startOffset)
    const start = before.toString().length
    const bounds = sentenceBounds(article.content, start, start + range.toString().length)
    const rect = range.getBoundingClientRect()
    selection.removeAllRanges()
    if (!bounds.quote || !/[A-Za-z]/.test(bounds.quote) || !rect) return
    const existing = article.targets.find((target) => (
      target.type === 'sentence'
      && target.startOffset === bounds.start
      && target.endOffset === bounds.end
    ))
    openBubble({
      type: 'sentence',
      quote: bounds.quote,
      startOffset: bounds.start,
      endOffset: bounds.end,
      targetId: existing?.id ?? null,
      rect,
    })
  }, [article, openBubble])

  const ensureBubbleTarget = useCallback(async () => {
    if (!bubble) return null
    if (bubble.targetId != null) {
      const existing = article?.targets.find((target) => target.id === bubble.targetId)
      if (existing) return existing
    }
    const created = await persistTarget({
      type: bubble.type,
      startOffset: bubble.startOffset,
      endOffset: bubble.endOffset,
      quote: bubble.quote,
    })
    if (created) {
      setBubble((current) => current ? { ...current, targetId: created.id } : current)
    }
    return created
  }, [article, bubble, persistTarget])

  const importArticle = async () => {
    if (!pasteText.trim() && !file) return
    setBusy('import')
    try {
      const created = await createEnglishReadingArticleApi({ text: pasteText, file })
      setPasteText('')
      setFile(null)
      await refreshTree()
      navigate(`/english/reading/materials/${created.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setBusy('')
    }
  }

  const explain = async () => {
    if (!bubble) return
    setBusy('explain')
    try {
      const target = await ensureBubbleTarget()
      if (!target) return
      await explainEnglishReadingTargetApi(target.id, { operationId: operationId('explain'), cefr: level })
      const refreshed = await refreshArticle(target.articleId)
      const nextTarget = refreshed.targets.find((item) => item.id === target.id)
      if (nextTarget) {
        setBubble((current) => current ? { ...current, targetId: nextTarget.id } : current)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '英文解释生成失败')
    } finally {
      setBusy('')
    }
  }

  const queueForArticle = async () => {
    if (!bubble) return
    setBusy('queue')
    try {
      const target = await ensureBubbleTarget()
      if (!target) return
      setSelectedIds((current) => toggleReadingTarget(current, target.id, true))
      toast.success('已加入待生成文章')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加入待生成文章失败')
    } finally {
      setBusy('')
    }
  }

  const generate = async () => {
    if (!article || selectedIds.length === 0) return
    setBusy('generate')
    try {
      const result = await generateTargetedEnglishReadingArticleApi(article.id, {
        operationId: operationId('article'), targetIds: selectedIds, config: { ...config, cefr: level },
      })
      setSelectedIds([])
      setBubble(null)
      await refreshTree()
      navigate(`/english/reading/materials/${result.article.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '定向文章生成失败')
    } finally {
      setBusy('')
    }
  }

  const renderedText = useMemo(() => {
    if (!article) return null
    const nodes: ReactNode[] = []
    let cursor = 0
    for (const match of article.content.matchAll(WORD_PATTERN)) {
      const start = match.index ?? 0
      const word = match[0]
      if (start > cursor) nodes.push(article.content.slice(cursor, start))
      const end = start + word.length
      const linked = article.targets.some((target) => target.linkedArticles.length > 0 && start >= target.startOffset && end <= target.endOffset)
      const active = Boolean(
        bubble
        && bubble.type === 'word'
        && bubble.startOffset === start
        && bubble.endOffset === end,
      )
      nodes.push(
        <button
          key={`${start}-${word}`}
          type="button"
          data-reading-word="true"
          className={cn(
            'rounded px-0.5 text-left hover:bg-primary/10',
            linked ? 'bg-amber-200/80 dark:bg-amber-500/30' : '',
            active ? 'bg-primary/15 ring-1 ring-primary/40' : '',
          )}
          onClick={(event) => void handleWord(word, start, end, event)}
        >{word}</button>,
      )
      cursor = end
    }
    if (cursor < article.content.length) nodes.push(article.content.slice(cursor))
    return nodes
  }, [article, bubble, handleWord])

  return (
    <EnglishZoneLayout zone="reading" title="缺口驱动阅读" description="从真实文章中选择不懂的词句，用同级英文解释并生成定向可理解输入。">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-4">
          <section className="rounded-2xl border bg-card p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="粘贴英文文章，或选择 txt / md / pdf 文件" className="min-h-24" />
              <div className="flex min-w-48 flex-col gap-2">
                <Input type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                <Button onClick={() => void importArticle()} disabled={busy === 'import' || (!pasteText.trim() && !file)}>
                  {busy === 'import' ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <FilePlus2 className="mr-2 size-4" />}导入文章
                </Button>
              </div>
            </div>
          </section>

          {article ? (
            <section className="relative rounded-2xl border bg-card p-5 md:p-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{article.kind === 'source' ? 'Source article' : `Generated · depth ${article.depth}`}</div>
                  <h2 className="text-2xl font-semibold">{article.title}</h2>
                  <p className="text-sm text-muted-foreground">{article.wordCount} words · 点击单词后弹出操作气泡</p>
                </div>
                <Button variant="outline" onClick={async () => {
                  const title = window.prompt('新的文章标题', article.title)?.trim()
                  if (!title) return
                  const renamed = await renameEnglishReadingArticleApi(article.id, title)
                  setArticle(renamed)
                  await refreshTree()
                }}>重命名</Button>
              </div>
              <div ref={readerRef} onMouseUp={() => void handleSelection()} className="whitespace-pre-wrap text-[18px] leading-9 text-foreground/90 selection:bg-primary/20">
                {renderedText}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">导入一篇英文文章开始阅读。</section>
          )}
        </main>

        <aside className="space-y-4">
          <section className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Current n level</h3>
              <select value={level} onChange={async (event) => {
                const next = event.target.value as CefrLevel
                setLevel(next)
                setConfig((current) => ({ ...current, cefr: next }))
                await updateEnglishReadingProfileApi({ declaredCefr: next })
              }} className="rounded-md border bg-background px-2 py-1 text-sm">
                {LEVELS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <p className="text-sm text-muted-foreground">
              点击阅读区单词，或在阅读区拖选句子，会在选中位置附近弹出操作气泡。只有手动点“加入文章”才会进入待生成列表。
            </p>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">待生成文章</h3><span className="text-xs text-muted-foreground">{selectedIds.length}/12</span></div>
            <div className="space-y-2">
              {queuedTargets.map((target) => (
                <label key={target.id} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
                  <input type="checkbox" checked={selectedIds.includes(target.id)} onChange={(event) => setSelectedIds((current) => toggleReadingTarget(current, target.id, event.target.checked))} />
                  <span className="min-w-0 flex-1"><span className="text-xs uppercase text-muted-foreground">{target.type}</span><span className="block truncate">{target.quote}</span></span>
                  <select value={target.priority} onChange={async (event) => {
                    await updateEnglishReadingTargetApi(target.id, Number(event.target.value))
                    await refreshArticle(target.articleId)
                  }} className="rounded border bg-background text-xs">
                    {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>P{value}</option>)}
                  </select>
                  <button type="button" onClick={async () => {
                    setSelectedIds((current) => current.filter((id) => id !== target.id))
                    await deleteEnglishReadingTargetApi(target.id)
                    setBubble((current) => current?.targetId === target.id ? { ...current, targetId: null } : current)
                    await refreshArticle(target.articleId)
                  }}><Trash2 className="size-4" /></button>
                </label>
              ))}
              {!queuedTargets.length ? <p className="text-sm text-muted-foreground">还没有加入待生成目标。在气泡里点“加入文章”。</p> : null}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <select value={config.wordCount} onChange={(event) => setConfig({ ...config, wordCount: Number(event.target.value) as 150 | 300 | 500 })} className="rounded-md border bg-background px-2 py-2 text-sm"><option value={150}>150词</option><option value={300}>300词</option><option value={500}>500词</option></select>
              <select value={config.genre} onChange={(event) => setConfig({ ...config, genre: event.target.value as ReadingArticleGenerationConfig['genre'] })} className="rounded-md border bg-background px-2 py-2 text-sm"><option value="argumentative">议论</option><option value="expository">说明</option><option value="narrative">叙事</option><option value="dialogue">对话</option></select>
              <Button variant="outline" onClick={() => setAdvanced((value) => !value)}>高级</Button>
            </div>
            {advanced ? <div className="mt-3 space-y-2"><Input value={config.topic} onChange={(event) => setConfig({ ...config, topic: event.target.value })} placeholder="可选主题要求" /><div className="grid grid-cols-3 gap-2"><NumberField label="词复现" value={config.wordRepetitions} onChange={(value) => setConfig({ ...config, wordRepetitions: value })} /><NumberField label="句变体" value={config.sentenceVariants} onChange={(value) => setConfig({ ...config, sentenceVariants: value })} /><select value={config.syntaxDensity} onChange={(event) => setConfig({ ...config, syntaxDensity: event.target.value as ReadingArticleGenerationConfig['syntaxDensity'] })} className="rounded-md border bg-background px-2 text-sm"><option value="low">低句法</option><option value="normal">正常</option><option value="high">高句法</option></select></div></div> : null}
            <Button className="mt-3 w-full" onClick={() => void generate()} disabled={!selectedIds.length || busy === 'generate' || (article?.depth ?? 2) >= 2}>{busy === 'generate' ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}生成定向文章</Button>
          </section>

          <section className="rounded-2xl border bg-card p-4"><h3 className="mb-3 font-semibold">文章历史</h3><div className="space-y-1">{tree.map((item) => <TreeRow key={item.id} item={item} activeId={article?.id ?? 0} onOpen={(id) => navigate(`/english/reading/materials/${id}`)} onDelete={async (id) => { if (!window.confirm('删除该文章及全部后代文章？')) return; await deleteEnglishReadingArticleApi(id); await refreshTree(); if (article?.id === id) navigate('/english/reading') }} />)}</div></section>
        </aside>
      </div>

      {bubble ? (
        <div
          ref={bubbleRef}
          role="dialog"
          aria-label="词句操作"
          data-testid="reading-action-bubble"
          className="fixed z-[140] max-h-[min(70vh,420px)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border bg-background p-3 text-primary shadow-lg"
          style={{ left: bubble.left, top: bubble.top }}
        >
          <TargetBubble
            bubble={bubble}
            target={activeTarget}
            level={level}
            busy={busy}
            queued={bubble.targetId != null && selectedIds.includes(bubble.targetId)}
            onExplain={explain}
            onQueue={() => void queueForArticle()}
            onClose={() => setBubble(null)}
            onOpen={(id) => navigate(`/english/reading/materials/${id}`)}
          />
        </div>
      ) : null}
    </EnglishZoneLayout>
  )
}

function TargetBubble({
  bubble,
  target,
  level,
  busy,
  queued,
  onExplain,
  onQueue,
  onClose,
  onOpen,
}: {
  bubble: SelectionBubble
  target: ReadingTarget | null
  level: CefrLevel
  busy: string
  queued: boolean
  onExplain: () => Promise<void>
  onQueue: () => void
  onClose: () => void
  onOpen: (id: number) => void
}) {
  const explanation = target?.explanations[0] ?? null
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{bubble.type}</div>
          <div className="truncate font-semibold">{bubble.quote}</div>
          {bubble.dictionary ? (
            <div className="text-sm text-muted-foreground">
              {bubble.dictionary.lemma}
              {bubble.dictionary.phoneticUs ? ` · ${bubble.dictionary.phoneticUs}` : ''}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {bubble.type === 'word' ? (
            <Button size="icon" variant="ghost" onClick={() => speakAmerican(bubble.quote)} aria-label="美式发音">
              <Volume2 className="size-4" />
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void onExplain()} disabled={busy === 'explain'}>
          {busy === 'explain' ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
          英文解释 · {level}
        </Button>
        <Button size="sm" variant="outline" onClick={onQueue} disabled={busy === 'queue' || queued}>
          {busy === 'queue' ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
          {queued ? '已加入文章' : '加入文章'}
        </Button>
      </div>
      {explanation ? <ExplanationView explanation={explanation} /> : null}
      {target?.linkedArticles.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item.id)}
          className="flex w-full items-center justify-between rounded-lg bg-amber-100 px-3 py-2 text-left text-sm text-amber-950"
        >
          <span className="truncate">{item.title}</span>
          <ChevronRight className="size-4" />
        </button>
      ))}
    </div>
  )
}

function ExplanationView({ explanation }: { explanation: ReadingExplanation }) {
  const result = explanation.result ?? {}
  const meaningHere = typeof result.meaningHere === 'string' ? result.meaningHere : null
  const englishExplanation = typeof result.englishExplanation === 'string' ? result.englishExplanation : null
  const otherUses = Array.isArray(result.otherCommonUses) ? result.otherCommonUses : []
  const howItWorks = Array.isArray(result.howItWorks) ? result.howItWorks : []

  if (meaningHere || englishExplanation || otherUses.length || howItWorks.length) {
    return (
      <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
        {meaningHere ? <p className="leading-6">{meaningHere}</p> : null}
        {englishExplanation ? <p className="leading-6">{englishExplanation}</p> : null}
        {otherUses.map((item, index) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          return (
            <div key={index} className="rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
              <div className="text-xs text-muted-foreground">
                {typeof row.partOfSpeech === 'string' ? row.partOfSpeech : 'use'}
              </div>
              <div>{typeof row.meaning === 'string' ? row.meaning : ''}</div>
              {typeof row.example === 'string' && row.example ? (
                <div className="mt-1 text-muted-foreground italic">{row.example}</div>
              ) : null}
            </div>
          )
        })}
        {howItWorks.map((item, index) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          return (
            <div key={index} className="rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
              <div className="font-medium">{typeof row.part === 'string' ? row.part : 'part'}</div>
              <div className="text-xs text-muted-foreground">{typeof row.role === 'string' ? row.role : ''}</div>
              <div>{typeof row.explanation === 'string' ? row.explanation : ''}</div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm font-sans">
      {JSON.stringify(result, null, 2)}
    </pre>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-xs text-muted-foreground">{label}<Input type="number" min={1} max={5} value={value} onChange={(event) => onChange(Math.max(1, Math.min(5, Number(event.target.value))))} /></label>
}

function TreeRow({ item, activeId, onOpen, onDelete }: { item: ReadingArticleTreeItem; activeId: number; onOpen: (id: number) => void; onDelete: (id: number) => Promise<void> }) {
  return <div><div className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${item.id === activeId ? 'bg-primary/10' : 'hover:bg-muted'}`}><button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => onOpen(item.id)}>{item.kind === 'source' ? <BookOpen className="size-4 shrink-0" /> : <Sparkles className="size-4 shrink-0" />}<span className="truncate">{item.title}</span></button><button type="button" onClick={() => void onDelete(item.id)}><Trash2 className="size-3.5 text-muted-foreground" /></button></div>{item.children.length ? <div className="ml-4 border-l pl-2">{item.children.map((child) => <TreeRow key={child.id} item={child} activeId={activeId} onOpen={onOpen} onDelete={onDelete} />)}</div> : null}</div>
}
