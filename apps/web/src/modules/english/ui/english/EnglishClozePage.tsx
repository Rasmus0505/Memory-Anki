import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { BookOpen, Copy, Search } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { EnglishLookupPanel, useEnglishLookup } from '@/modules/english-lookup/public'
import { getEnglishClozeApi } from '../../domain/english-entity/api'
import { useClozeMarks } from '../../domain/english-cloze/clozeMarks'
import {
  articleCopyText,
  buildHardKeys,
  collectVocabKeys,
  isSuggestedKey,
  isUserMarked,
  optionsCopyText,
  tokenizeParagraph,
  toggleVocabWord,
  vocabCopyText,
  type ClozeCorpus,
  type ClozeToken,
  type ClozeYear,
} from '../../domain/english-cloze/clozeReading'
import { EnglishZoneLayout } from '../english-shell'

async function copyText(text: string) {
  if (!text.trim()) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the older selection path.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', 'true')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  return ok
}

function WordButton({
  token,
  suggested,
  marked,
  lookupMode,
  onMark,
  onLookup,
}: {
  token: Extract<ClozeToken, { kind: 'word' | 'blank' }>
  suggested: boolean
  marked: boolean
  lookupMode: boolean
  onMark: () => void
  onLookup: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      data-testid={token.kind === 'blank' ? `cloze-blank-${token.n}` : 'cloze-word'}
      data-vocab={marked || suggested ? 'true' : 'false'}
      onClick={(event) => (lookupMode ? onLookup(event) : onMark())}
      className={cn(
        'inline rounded-md px-0.5 py-0.5 text-left align-baseline transition-colors',
        'hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        marked && 'bg-amber-200/90 text-amber-950 dark:bg-amber-700/45 dark:text-amber-50',
        !marked && suggested && 'bg-sky-100 text-sky-950 dark:bg-sky-800/40 dark:text-sky-50',
        token.kind === 'blank' && 'font-medium underline decoration-dotted underline-offset-4',
      )}
    >
      {token.text}
    </button>
  )
}

export default function EnglishClozePage() {
  const [corpus, setCorpus] = useState<ClozeCorpus | null>(null)
  const [error, setError] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(true)
  const [lookupMode, setLookupMode] = useState(false)
  const [copyMenu, setCopyMenu] = useState(false)
  const [copied, setCopied] = useState('')
  const { marks, writeMarks } = useClozeMarks()
  const lookup = useEnglishLookup({ isActive: true })

  useEffect(() => {
    let cancelled = false
    getEnglishClozeApi()
      .then((data) => {
        if (cancelled) return
        setCorpus(data)
        setYear((current) => current ?? data.years[0]?.year ?? null)
      })
      .catch(() => {
        if (!cancelled) setError('完形文章暂时打不开，过一会儿再试。')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const current = corpus?.years.find((item) => item.year === year) ?? null
  const hardKeys = useMemo(() => (corpus ? buildHardKeys(corpus.years) : new Set<string>()), [corpus])
  const yearVocab = useMemo(
    () => (current ? collectVocabKeys([current], hardKeys, marks) : []),
    [current, hardKeys, marks],
  )
  const allVocab = useMemo(
    () => (corpus ? collectVocabKeys(corpus.years, hardKeys, marks) : []),
    [corpus, hardKeys, marks],
  )

  async function copyLabel(label: string, text: string) {
    const ok = await copyText(text)
    setCopied(ok ? label : '没复制成功')
    setCopyMenu(false)
    window.setTimeout(() => setCopied(''), 1600)
  }

  function markWord(key: string) {
    writeMarks(toggleVocabWord(key, hardKeys, marks))
  }

  return (
    <EnglishZoneLayout
      zone="cloze"
      title="完形阅读"
      description="答案已经填好。浅蓝是先标出的难词，琥珀是你自己标的。点一下切换，再点取消。"
    >
      <div className="flex flex-col gap-4" data-testid="english-cloze-page">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1" role="tablist" aria-label="年份">
            {(corpus?.years ?? []).map((item) => (
              <button
                key={item.year}
                type="button"
                role="tab"
                aria-selected={item.year === year}
                onClick={() => setYear(item.year)}
                className={cn(
                  'min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium',
                  item.year === year
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {item.year}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={lookupMode}
            onClick={() => setLookupMode((value) => !value)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm',
              lookupMode ? 'border-foreground bg-foreground text-background' : 'border-border bg-background',
            )}
          >
            <Search className="size-4" />
            {lookupMode ? '查词中' : '查词'}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setCopyMenu((value) => !value)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm"
            >
              <Copy className="size-4" />
              {copied || '复制'}
            </button>
            {copyMenu && current ? (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-border bg-background p-1 shadow-soft">
                <CopyItem label="复制这篇文章" onClick={() => void copyLabel('已复制文章', articleCopyText(current))} />
                <CopyItem label="复制这年的生词" onClick={() => void copyLabel('已复制生词', vocabCopyText(yearVocab))} />
                <CopyItem label="复制全部生词" onClick={() => void copyLabel('已复制全部', vocabCopyText(allVocab))} />
                <CopyItem label="复制选项" onClick={() => void copyLabel('已复制选项', optionsCopyText(current))} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setOptionsOpen((value) => !value)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm xl:hidden"
          >
            <BookOpen className="size-4" />
            {optionsOpen ? '收起选项' : '选项'}
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          {lookupMode ? '现在点词会打开词典。再点「查词中」回到标生词。' : '点词标生词。划选几个词也可以用查词。'}
          {yearVocab.length ? ` 这一年 ${yearVocab.length} 个生词。` : ''}
        </p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!error && corpus && corpus.years.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            文章还在准备，刷新后就能按年份读。
          </p>
        ) : null}

        {current ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <article className="rounded-3xl border border-border/70 bg-card p-5 text-[1.05rem] leading-8 shadow-soft sm:p-7">
              {current.paragraphs.map((paragraph, index) => (
                <p key={`${current.year}-${index}`} className="mb-4 last:mb-0">
                  {tokenizeParagraph(paragraph, current.blanks).map((token, tokenIndex) => {
                    if (token.kind === 'gap') return <span key={tokenIndex}>{token.text}</span>
                    return (
                      <WordButton
                        key={tokenIndex}
                        token={token}
                        suggested={isSuggestedKey(token.key, hardKeys, marks)}
                        marked={isUserMarked(token.key, marks)}
                        lookupMode={lookupMode}
                        onMark={() => markWord(token.key)}
                        onLookup={(event) => lookup.handleTokenClick(token.text, event)}
                      />
                    )
                  })}
                </p>
              ))}
            </article>
            {optionsOpen ? <OptionsPanel year={current} /> : null}
          </div>
        ) : null}
      </div>
      <EnglishLookupPanel lookup={lookup} />
    </EnglishZoneLayout>
  )
}

function CopyItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-muted">
      {label}
    </button>
  )
}

function OptionsPanel({ year }: { year: ClozeYear }) {
  return (
    <aside className="h-fit rounded-3xl border border-border/70 bg-muted/40 p-4 xl:sticky xl:top-16">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">选项 · 正确答案已标出</h2>
      <ol className="space-y-3 text-sm">
        {year.blanks.map((blank) => (
          <li key={blank.n}>
            <span className="mr-1 font-medium">{blank.n}.</span>
            {blank.options.map((option) => (
              <span
                key={option.key}
                className={cn(
                  'mr-2 inline-block',
                  option.key === blank.answer && 'rounded bg-emerald-100 px-1 text-emerald-950 dark:bg-emerald-800/40 dark:text-emerald-50',
                )}
              >
                {option.key}. {option.text}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </aside>
  )
}
