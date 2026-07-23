import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpenText,
  Captions,
  MessagesSquare,
  NotebookPen,
} from 'lucide-react'
import { getEnglishWorkspaceApi, listEnglishPatternsApi } from '@/modules/english/domain/english-entity/api'
import { getEnglishReadingWorkspaceApi } from '@/modules/english-reading/public'
import type { ReactNode } from 'react'
import type {
  EnglishWorkspaceResponse,
  ReadingWorkspaceResponse,
} from '@/shared/api/contracts'
import {
  EnglishContinueHero,
  EnglishStatStrip,
  EnglishZoneLayout,
} from '@/modules/english/ui/english-shell'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { formatDuration } from '@/modules/session/public'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'
import { EnglishWorkspaceSkeleton } from './EnglishWorkspaceSkeleton'

export default function EnglishHubPage() {
  const [listening, setListening] = useState<EnglishWorkspaceResponse | null>(null)
  const [reading, setReading] = useState<ReadingWorkspaceResponse | null>(null)
  const [duePatterns, setDuePatterns] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listeningWorkspace, readingWorkspace, patterns] = await Promise.all([
        getEnglishWorkspaceApi(),
        getEnglishReadingWorkspaceApi(),
        listEnglishPatternsApi({ limit: 1 }).catch(() => null),
      ])
      setListening(listeningWorkspace)
      setReading(readingWorkspace)
      setDuePatterns(patterns?.dueSentenceCount ?? 0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载英语总览失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading || !listening || !reading) {
    return <EnglishWorkspaceSkeleton />
  }

  const continueCourse = listening.continueCourse
  const continueMaterial =
    reading.recentMaterials.find((item) => item.latestVersionId) ??
    reading.recentMaterials[0] ??
    null

  return (
    <EnglishZoneLayout
      zone="hub"
      title="英语学习"
      description="上方可随时切换听力 / 阅读 / 句模 / 生词；句模与生词是全局库。"
      headerAside={
        <div className="rounded-2xl border border-border/70 bg-card/90 px-4 py-3 text-right shadow-soft">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            今日英语
          </div>
          <div className="mt-1 text-lg font-semibold">
            {formatDuration(
              listening.stats.today_practice_seconds + reading.stats.todayReadingSeconds,
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5" data-testid="english-hub-overview">
        <div className="grid gap-4 lg:grid-cols-2">
          <ZoneCard
            testId="english-hub-listening-card"
            eyebrow="Listening"
            title="英语听力"
            description="视频转课程、逐句听写。生成任务与课程列表都在听力区。"
            icon={Captions}
            href="/english/listening"
            meta={
              <>
                <Badge variant="secondary">{listening.stats.total_courses} 课</Badge>
                <Badge variant="outline">{listening.stats.unfinished_courses} 未完成</Badge>
              </>
            }
            continueLabel={continueCourse ? '继续听写' : '进入听力区'}
            continueHref={
              continueCourse
                ? `/english/listening/courses/${continueCourse.id}`
                : '/english/listening'
            }
            continueHint={
              continueCourse
                ? `${continueCourse.title} · 第 ${continueCourse.currentSentenceIndex + 1}/${continueCourse.sentenceCount} 句`
                : '上传视频开始沉浸听写'
            }
          />

          <ZoneCard
            testId="english-hub-reading-card"
            eyebrow="Reading"
            title="英语阅读"
            description="材料书架、沉浸阅读、点词查词，再把好句子发散到句模。"
            icon={BookOpenText}
            href="/english/reading"
            meta={
              <>
                <Badge variant="secondary">{reading.stats.totalMaterials} 材料</Badge>
                <Badge variant="outline">{reading.profile.declaredCefr}</Badge>
              </>
            }
            continueLabel={continueMaterial ? '继续阅读' : '进入阅读区'}
            continueHref={
              continueMaterial
                ? `/english/reading/materials/${continueMaterial.id}`
                : '/english/reading'
            }
            continueHint={
              continueMaterial
                ? `${continueMaterial.title} · ${continueMaterial.wordCount} 词`
                : '上传或粘贴材料，开始阅读'
            }
          />
        </div>

        <EnglishStatStrip
          items={[
            {
              label: '今日听力',
              value: formatDuration(listening.stats.today_practice_seconds),
            },
            {
              label: '今日阅读',
              value: formatDuration(reading.stats.todayReadingSeconds),
            },
            { label: '句模待复习', value: duePatterns },
          ]}
        />

        <section className="grid gap-3 sm:grid-cols-2">
          <SecondaryLink
            to="/english/patterns"
            icon={MessagesSquare}
            title="句模"
            description={
              duePatterns > 0 ? `${duePatterns} 句到期可复习` : '全局话题句模与 FSRS 复习'
            }
          />
          <SecondaryLink
            to="/english/vocab"
            icon={NotebookPen}
            title="生词本"
            description="阅读/听力查词后沉淀的生词"
          />
        </section>

        {(continueCourse || continueMaterial) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {continueCourse ? (
              <EnglishContinueHero
                eyebrow="Continue listening"
                title={continueCourse.title}
                description={`已进行到第 ${continueCourse.currentSentenceIndex + 1} / ${continueCourse.sentenceCount} 句`}
                meta={<Badge variant="secondary">未完成</Badge>}
                primaryLabel="继续听写"
                primaryHref={`/english/listening/courses/${continueCourse.id}`}
              />
            ) : null}
            {continueMaterial ? (
              <EnglishContinueHero
                eyebrow="Continue reading"
                title={continueMaterial.title}
                description="打开最近一篇材料，进入沉浸阅读。"
                meta={
                  <>
                    <Badge variant="outline">{continueMaterial.sourceType.toUpperCase()}</Badge>
                    <span>{continueMaterial.wordCount} 词</span>
                  </>
                }
                primaryLabel="继续阅读"
                primaryHref={`/english/reading/materials/${continueMaterial.id}`}
              />
            ) : null}
          </div>
        )}
      </div>
    </EnglishZoneLayout>
  )
}

function ZoneCard({
  testId,
  eyebrow,
  title,
  description,
  icon: Icon,
  href,
  meta,
  continueLabel,
  continueHref,
  continueHint,
}: {
  testId: string
  eyebrow: string
  title: string
  description: string
  icon: typeof Captions
  href: string
  meta: ReactNode
  continueLabel: string
  continueHref: string
  continueHint: string
}) {
  return (
    <section
      data-testid={testId}
      className="flex flex-col rounded-3xl border border-border/70 bg-card/95 p-5 shadow-card sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-info">
            {eyebrow}
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="flex size-11 items-center justify-center rounded-2xl bg-info/10 text-info">
          <Icon className="size-5" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">{meta}</div>

      <div className="mt-4 rounded-2xl border border-border/60 bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground">
        {continueHint}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild className="min-h-11 rounded-xl">
          <Link to={continueHref}>
            {continueLabel}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-11 rounded-xl">
          <Link to={href}>打开分区</Link>
        </Button>
      </div>
    </section>
  )
}

function SecondaryLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string
  icon: typeof MessagesSquare
  title: string
  description: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-border/70 bg-card/95 px-4 py-4 shadow-soft transition',
        'hover:border-info/30 hover:bg-info/5',
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
