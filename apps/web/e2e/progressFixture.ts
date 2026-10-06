import type { LearningProgressMetrics, LearningProgressNode, LearningProgressResponse } from '../src/shared/api/contracts/learningProgress'

const emptyMetrics = (): LearningProgressMetrics => ({ memory_total: 0, memory_reviewed: 0, memory_due: 0, quiz_total: 0, quiz_answered: 0 })
function leaf(id: string, name: string, palace: number, reviewed: number, due: number, total: number, answered: number): LearningProgressNode {
  return { id, name, kind: 'memory_point', palace_id: palace, children: [], metrics: { memory_total: 1, memory_reviewed: reviewed, memory_due: due, quiz_total: total, quiz_answered: answered } }
}
// Fixture questions are disjoint across leaves, so parent sums equal distinct-question counts.
function branch(id: string, name: string, kind: LearningProgressNode['kind'], palace: number | null, children: LearningProgressNode[]): LearningProgressNode {
  const metrics = emptyMetrics()
  for (const child of children) for (const key of Object.keys(metrics) as (keyof LearningProgressMetrics)[]) metrics[key] += child.metrics[key]
  return { id, name, kind, palace_id: palace, children, metrics }
}
const roots = [
  branch('subject:1', '临床医学', 'subject', null, [
    branch('palace:11', '心血管系统', 'palace', 11, [
      branch('chapter:11', '循环生理', 'chapter', 11, [
        branch('unit:11', '心动周期', 'unit', 11, [
          leaf('point:111', '心室收缩期', 11, 1, 1, 4, 3),
          leaf('point:112', '心室舒张期', 11, 1, 0, 3, 3),
          leaf('point:113', '每搏输出量', 11, 0, 0, 2, 0),
        ]),
        branch('unit:12', '血流动力学', 'unit', 11, [
          leaf('point:114', '动脉血压', 11, 1, 1, 3, 1),
          leaf('point:115', '静脉回流', 11, 0, 0, 0, 0),
        ]),
      ]),
    ]),
    branch('palace:12', '呼吸系统', 'palace', 12, [
      branch('chapter:12', '气体交换', 'chapter', 12, [
        leaf('point:121', '肺泡通气', 12, 1, 0, 5, 4),
        leaf('point:122', '氧气运输', 12, 0, 0, 3, 1),
      ]),
    ]),
  ]),
  branch('subject:2', '英语', 'subject', null, [
    branch('palace:21', '学术阅读', 'palace', 21, [
      branch('chapter:21', '论证结构', 'chapter', 21, [
        leaf('point:211', '因果关系', 21, 1, 0, 4, 2),
        leaf('point:212', '转折与让步', 21, 0, 0, 2, 0),
      ]),
    ]),
  ]),
]
export const progressFixture: LearningProgressResponse = {
  roots, metrics: branch('all', '全部', 'subject', null, roots).metrics,
  generated_at: '2026-07-15T09:30:00+08:00',
  notes: ['E2E 固定示例数据，仅用于界面验收与截图，不代表真实学习记录。'],
}
export const emptyProgressFixture: LearningProgressResponse = { roots: [], metrics: emptyMetrics(), generated_at: progressFixture.generated_at, notes: [] }
