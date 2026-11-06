import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { sanitizeFreestyleFeedConfig } from '@/modules/practice/domain/feedConfig'
import type {
  FreestyleFeedConfig,
  FreestyleLearnScope,
  FreestylePalaceOrder,
  FreestyleUnitOrder,
} from '@/shared/api/contracts'
import {
  allFreestylePalaceIdsFromSubjects,
  normalizeFreestylePalaceSelection,
  toggleFreestylePalaceGroup,
  type FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import {
  duePalaceIdsFromSubjects,
  FreestylePalaceScopeTree,
} from './FreestylePalaceScopeTree'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

const PALACE_ORDER_OPTIONS: Array<{ value: FreestylePalaceOrder; label: string }> = [
  { value: 'finish_palace_then_next', label: '一个刷完再换' },
  { value: 'interleave_palaces', label: '多宫殿轮流' },
  { value: 'exam_priority', label: '考试优先' },
]

const UNIT_ORDER_OPTIONS: Array<{ value: FreestyleUnitOrder; label: string }> = [
  { value: 'structured', label: '按知识结构' },
  { value: 'random', label: '随机打乱' },
]

const LEARN_SCOPE_OPTIONS: Array<{ value: FreestyleLearnScope; label: string }> = [
  { value: 'new', label: '新学' },
  { value: 'review', label: '复习' },
]

export const STREAM_LABELS = {
  memory_palace: '记忆宫殿',
  quiz: '刷题',
} as const

function labelOf(value: string, options: ReadonlyArray<{ value: string; label: string }>) {
  return options.find((item) => item.value === value)?.label ?? ''
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function OptionCards<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              'rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors',
              selected ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-background/80 hover:bg-muted/60',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Plain-language readout of what the saved config will produce. */
export function summarizeRoundConfig(
  config: FreestyleFeedConfig,
  subjects: FreestylePalaceScopeSubject[],
): Array<{ label: string; value: string }> {
  const palace = config.streams.memory_palace
  const selectedCount = palace.specific_palace_ids.length
  const totalCount = allFreestylePalaceIdsFromSubjects(subjects).length
  const scope = config.learn_scope.map((item) => (item === 'new' ? '新学' : '复习'))
  return [
    { label: '学什么', value: scope.join(' + ') },
    {
      label: '宫殿',
      value: [
        selectedCount ? `已选 ${selectedCount} 座` : `全部 ${totalCount} 座`,
        labelOf(palace.palace_order, PALACE_ORDER_OPTIONS),
        labelOf(palace.unit_order, UNIT_ORDER_OPTIONS),
      ].filter(Boolean).join(' · '),
    },
  ]
}

export function FreestyleTrainingConfigForm({
  config,
  scopeSubjects,
  onChange,
  scopeLocked = false,
}: {
  config: FreestyleFeedConfig
  scopeSubjects: FreestylePalaceScopeSubject[]
  onChange: (config: FreestyleFeedConfig) => void
  scopeLocked?: boolean
}) {
  const palace = config.streams.memory_palace
  const selectedIds = palace.specific_palace_ids
  const allIds = allFreestylePalaceIdsFromSubjects(scopeSubjects)
  const dueIds = duePalaceIdsFromSubjects(scopeSubjects)

  const updatePalaceStream = (patch: Record<string, unknown>) => {
    onChange(sanitizeFreestyleFeedConfig({
      ...config,
      streams: {
        ...config.streams,
        memory_palace: { ...palace, ...patch },
      },
    }))
  }

  /** Palace ids are normalized once: a full selection stays an explicit list. */
  const applyPalaceIds = (ids: number[]) => {
    const normalized = normalizeFreestylePalaceSelection(
      { specific_palace_ids: [], subject_scope: 'all', subject_ids: [] },
      ids,
      scopeSubjects,
    )
    updatePalaceStream(normalized)
  }

  const togglePalace = (ids: number[], checked: boolean) => {
    applyPalaceIds(toggleFreestylePalaceGroup(selectedIds, ids, checked))
  }

  // At least one pool stays on: an empty 新学+复习 would be an empty round.
  const toggleLearnScope = (scope: FreestyleLearnScope) => {
    const active = config.learn_scope.includes(scope)
    if (active && config.learn_scope.length <= 1) return
    const next = active
      ? config.learn_scope.filter((item) => item !== scope)
      : (['new', 'review'] as const).filter((item) => item === scope || config.learn_scope.includes(item))
    onChange(sanitizeFreestyleFeedConfig({ ...config, learn_scope: [...next] }))
  }

  if (scopeLocked) {
    return (
      <div className="rounded-xl border border-border/60 bg-background/80 px-3.5 py-3 text-sm">
        只复习当前宫殿
      </div>
    )
  }

  return (
    <div className="grid items-start gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Section title="学什么">
          <div role="group" aria-label="学什么" className="grid grid-cols-2 gap-1.5">
            {LEARN_SCOPE_OPTIONS.map((option) => {
              const checked = config.learn_scope.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={option.label}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors',
                    checked
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-background/80 text-muted-foreground hover:bg-muted/60',
                  )}
                  onClick={() => toggleLearnScope(option.value)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-4 items-center justify-center rounded border',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
                    )}
                  >
                    {checked ? '✓' : ''}
                  </span>
                  {option.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">新学＝一次都没通过过的单元。</p>
        </Section>

        <Section title="多座宫殿时">
          <OptionCards
            label="多个宫殿时"
            options={PALACE_ORDER_OPTIONS}
            value={palace.palace_order}
            onChange={(next) => updatePalaceStream({ palace_order: next })}
          />
        </Section>

        <Section title="宫殿内顺序">
          <OptionCards
            label="宫殿内单元顺序"
            options={UNIT_ORDER_OPTIONS}
            value={palace.unit_order}
            onChange={(next) => updatePalaceStream({ unit_order: next })}
          />
        </Section>
      </div>

      <Section
        title="宫殿"
        action={(
          <span className="text-xs tabular-nums text-muted-foreground">
            {selectedIds.length ? `已选 ${selectedIds.length} 座` : `全部 ${allIds.length} 座`}
          </span>
        )}
      >
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))}
            onClick={() => applyPalaceIds(allIds)}
          >
            全选
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!dueIds.length}
            onClick={() => applyPalaceIds(dueIds)}
          >
            只选到期
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => applyPalaceIds([])}
          >
            <RotateCcw className="size-3.5" />重置
          </Button>
        </div>
        <div className="max-h-[min(50dvh,30rem)] overflow-y-auto overscroll-contain pr-1">
          <FreestylePalaceScopeTree
            subjects={scopeSubjects}
            selectedIds={selectedIds}
            onToggle={togglePalace}
            defaultExpanded={false}
          />
        </div>
      </Section>
    </div>
  )
}
