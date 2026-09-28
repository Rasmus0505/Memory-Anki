import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExamPalaceRow, MindMapDoc } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { buildNodeRecall, buildPathQuestion, flattenDoc, type DrillNode } from '../../model/recallDrill'
import { ExamStarBadge } from '../ExamStarBadge'

type DrillMode = 'node' | 'path'

interface ExamRecallDrillProps {
  palaces: ExamPalaceRow[]
  loadDoc: (palaceId: number) => Promise<MindMapDoc | null>
}

export function ExamRecallDrill({ palaces, loadDoc }: ExamRecallDrillProps) {
  const [palaceId, setPalaceId] = useState<number | null>(palaces[0]?.id ?? null)
  const [mode, setMode] = useState<DrillMode>('node')
  const [nodes, setNodes] = useState<DrillNode[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [revealed, setRevealed] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  // Only the latest palace's doc may populate the drill.
  const tokenRef = useRef(0)

  useEffect(() => {
    if (palaceId == null) return
    const token = ++tokenRef.current
    setNodes(null)
    setLoadError(null)
    loadDoc(palaceId)
      .then((doc) => {
        if (token === tokenRef.current) setNodes(flattenDoc(doc))
      })
      .catch((caught: unknown) => {
        if (token === tokenRef.current) setLoadError(caught instanceof Error ? caught.message : '导图加载失败')
      })
  }, [loadDoc, palaceId])

  const prompt = useMemo(() => {
    if (!nodes) return null
    return mode === 'node' ? buildNodeRecall(nodes, seed) : buildPathQuestion(nodes, seed)
  }, [mode, nodes, seed])

  const next = () => {
    setSeed((value) => value + 1)
    setRevealed(false)
    setChosen(null)
  }

  if (!palaces.length) return <p className="text-sm text-muted-foreground">还没有可抽查的宫殿。</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="抽查宫殿"
          className="h-8 max-w-[16rem] rounded-lg border border-border bg-card px-2 text-sm"
          value={palaceId ?? ''}
          onChange={(event) => {
            setPalaceId(Number(event.target.value))
            next()
          }}
        >
          {palaces.map((row) => (
            <option key={row.id} value={row.id}>
              {'★'.repeat(row.stars)} {row.title}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="抽查方式" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
          {([['node', '随机抽节点'], ['path', '路径追问']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => {
                setMode(value)
                next()
              }}
              className={`rounded-md px-2.5 py-1 transition-colors ${mode === value ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[9rem] rounded-2xl bg-muted/40 p-4" aria-live="polite">
        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
        {!loadError && !nodes ? <p className="text-sm text-muted-foreground">正在读取导图…</p> : null}
        {nodes && !prompt ? (
          <p className="text-sm text-muted-foreground">
            {mode === 'node' ? '这张导图没有可展开回忆的节点。' : '路径追问需要至少两个一级分支和更深的叶子节点。'}
          </p>
        ) : null}

        {prompt?.kind === 'node' ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{prompt.node.path.join(' › ')}</p>
            <p className="text-lg font-semibold">「{prompt.node.text}」下面有哪些？</p>
            <p className="text-xs text-muted-foreground">先在心里说出全部 {prompt.node.children.length} 项，再展开核对。</p>
            {revealed ? (
              <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-sm">
                {prompt.node.children.map((text, index) => (
                  <li key={`${index}-${text}`}>{text}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}

        {prompt?.kind === 'path' ? (
          <div className="flex flex-col gap-2">
            <p className="text-lg font-semibold">「{prompt.node.text}」属于哪一支？</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {prompt.options.map((option) => {
                const isAnswer = option === prompt.answer
                const tone = chosen == null ? 'bg-card hover:bg-accent' : isAnswer ? 'bg-success/20 ring-1 ring-success' : option === chosen ? 'bg-destructive/15 ring-1 ring-destructive' : 'bg-card opacity-60'
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={chosen != null}
                    onClick={() => {
                      setChosen(option)
                      setRevealed(true)
                    }}
                    className={`rounded-xl px-3 py-2 text-left text-sm shadow-sm transition-colors ${tone}`}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
            {revealed ? <p className="text-xs text-muted-foreground">完整路径：{[...prompt.node.path, prompt.node.text].join(' › ')}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {prompt?.kind === 'node' && !revealed ? (
          <Button type="button" size="sm" onClick={() => setRevealed(true)}>展开核对</Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={next} disabled={!nodes}>
          下一题
        </Button>
        {palaceId != null ? (
          <ExamStarBadge stars={palaces.find((row) => row.id === palaceId)?.stars ?? 1} className="ml-auto" />
        ) : null}
      </div>
    </div>
  )
}
