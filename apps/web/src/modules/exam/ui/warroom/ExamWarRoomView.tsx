import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ExamOverview, MindMapDoc, SubjectSummary } from '@/shared/api/contracts'
import { Settings2 } from 'lucide-react'
import { PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { formatPercent } from '../../model/examFormat'
import { ExamKnowledgeMap } from './ExamKnowledgeMap'
import { ExamRecallDrill } from './ExamRecallDrill'
import { ExamRetentionChart } from './ExamRetentionChart'
import { ExamSettingsCard } from './ExamSettingsCard'
import { ExamHeadline, ExamStarDistribution, ExamWeakList } from './ExamSummaryPanels'

function Panel({ title, description, children, className = '', id }: { title: string; description?: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`flex flex-col gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-card ${className}`}>
      <header>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  )
}

interface ExamWarRoomViewProps {
  overview: ExamOverview
  subjects: SubjectSummary[]
  onChanged: () => void
  loadDoc: (palaceId: number) => Promise<MindMapDoc | null>
}

export function ExamWarRoomView({ overview, subjects, onChanged, loadDoc }: ExamWarRoomViewProps) {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        title="考试作战室"
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <a href="#exam-settings">
                <Settings2 />
                考试设置
              </a>
            </Button>
            <Button asChild size="sm">
              <Link to="/freestyle">按考试优先开始复习</Link>
            </Button>
          </>
        }
      />

      <ExamHeadline overview={overview} />

      <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="记忆保留曲线" description="绿色为实际通过率，虚线为从今天起不复习时的预测保留">
          <ExamRetentionChart retention={overview.retention} daysLeft={overview.days_left} />
        </Panel>
        <Panel title="各科进度">
          <ul className="flex flex-col gap-3">
            {overview.subjects.map((subject) => (
              <li key={subject.id} className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: subject.color }} aria-hidden="true" />
                    {subject.name}
                    {subject.exam_share != null ? <span className="text-xs text-muted-foreground">占 {subject.exam_share}%</span> : null}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatPercent(subject.mastery_ratio)} → {formatPercent(subject.predicted_ratio)}
                  </span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: `${subject.predicted_ratio * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${subject.mastery_ratio * 100}%` }} />
                </div>
              </li>
            ))}
            {!overview.subjects.length ? <li className="text-sm text-muted-foreground">暂无学科数据。</li> : null}
          </ul>
        </Panel>
      </div>

      <Panel title="知识地图" description="章节和宫殿按掌握度着色；点星星直接修改考试重要度，章节星级会被未单独设置的宫殿继承">
        <ExamKnowledgeMap overview={overview} onChanged={onChanged} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <Panel title="星级分布">
          <ExamStarDistribution overview={overview} />
        </Panel>
        <Panel title="最该补的地方" description="按 星级 × 遗忘程度 × 学科占比 排序">
          <ExamWeakList rows={overview.weak} />
        </Panel>
      </div>

      <Panel title="导图抽查" description="只练不评分，不影响复习排期">
        <ExamRecallDrill palaces={overview.palaces.filter((row) => row.unit_count > 0)} loadDoc={loadDoc} />
      </Panel>

      <Panel title="考试设置" className="scroll-mt-6" id="exam-settings">
        <ExamSettingsCard overview={overview} subjects={subjects} onSaved={onChanged} />
      </Panel>
    </div>
  )
}
