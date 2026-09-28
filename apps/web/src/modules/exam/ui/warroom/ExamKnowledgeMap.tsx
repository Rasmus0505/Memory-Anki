import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ExamOverview, ExamPalaceRow } from '@/shared/api/contracts'
import { buildKnowledgeMap, formatPercent, masteryColor, nodeMastery, type ChapterNode } from '../../model/examFormat'
import { ExamStarPicker } from '../ExamStarPicker'

function PalaceTile({ palace, onChanged }: { palace: ExamPalaceRow; onChanged: () => void }) {
  const learned = palace.learned_count > 0
  return (
    <div
      className={`exam-mastery-tile flex min-w-[9rem] flex-col gap-1 rounded-xl border border-border/60 p-2.5 text-xs shadow-sm ${palace.stars === 3 ? 'exam-key-card' : ''}`}
      style={{ background: masteryColor(palace.mastery_ratio, learned) }}
    >
      <Link to={`/palaces/${palace.id}`} className="line-clamp-2 font-medium text-foreground hover:underline">
        {palace.title}
      </Link>
      <span className="text-muted-foreground">
        {palace.unit_count ? `${palace.learned_count}/${palace.unit_count} 单元 · 掌握 ${formatPercent(palace.mastery_ratio)}` : '暂无复习单元'}
      </span>
      <ExamStarPicker
        kind="palace"
        entityId={palace.id}
        stars={palace.stars}
        source={palace.stars_source}
        ownStars={palace.own_stars}
        onSaved={onChanged}
      />
    </div>
  )
}

function ChapterBlock({ node, depth, onChanged }: { node: ChapterNode; depth: number; onChanged: () => void }) {
  const mastery = nodeMastery(node)
  return (
    <section className={depth ? 'ml-3 border-l border-border/60 pl-3' : ''}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: masteryColor(mastery, node.learnedCount > 0) }}
          aria-hidden="true"
        />
        <h4 className="text-sm font-medium">{node.chapter.name}</h4>
        <span className="text-xs text-muted-foreground">
          {node.unitCount ? `掌握 ${formatPercent(mastery)} · ${node.learnedCount}/${node.unitCount}` : '暂无单元'}
        </span>
        <ExamStarPicker
          kind="chapter"
          entityId={node.chapter.id}
          stars={node.chapter.exam_stars ?? 1}
          source={node.chapter.exam_stars_source}
          ownStars={node.chapter.exam_stars}
          onSaved={onChanged}
        />
      </header>
      {node.palaces.length ? (
        <div className="flex flex-wrap gap-2 pb-2">
          {node.palaces.map((palace) => (
            <PalaceTile key={palace.id} palace={palace} onChanged={onChanged} />
          ))}
        </div>
      ) : null}
      {node.children.map((child) => (
        <ChapterBlock key={child.chapter.id} node={child} depth={depth + 1} onChanged={onChanged} />
      ))}
    </section>
  )
}

export function ExamKnowledgeMap({ overview, onChanged }: { overview: ExamOverview; onChanged: () => void }) {
  const subjects = overview.subjects
  const [activeId, setActiveId] = useState<number | null>(null)
  const subjectId = activeId ?? subjects[0]?.id ?? null
  if (subjectId == null) {
    return <p className="text-sm text-muted-foreground">还没有带学科的宫殿。给宫殿绑定学科后，这里会按章节点亮掌握度。</p>
  }
  const { roots, loose } = buildKnowledgeMap(overview, subjectId)
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="学科" className="flex flex-wrap gap-1.5">
        {subjects.map((subject) => (
          <button
            key={subject.id}
            type="button"
            role="tab"
            aria-selected={subject.id === subjectId}
            onClick={() => setActiveId(subject.id)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              subject.id === subjectId ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {subject.name} · {formatPercent(subject.mastery_ratio)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-col gap-1">
        {roots.map((node) => (
          <ChapterBlock key={node.chapter.id} node={node} depth={0} onChanged={onChanged} />
        ))}
        {loose.length ? (
          <section>
            <h4 className="py-1.5 text-sm font-medium text-muted-foreground">未归入章节</h4>
            <div className="flex flex-wrap gap-2">
              {loose.map((palace) => (
                <PalaceTile key={palace.id} palace={palace} onChanged={onChanged} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
