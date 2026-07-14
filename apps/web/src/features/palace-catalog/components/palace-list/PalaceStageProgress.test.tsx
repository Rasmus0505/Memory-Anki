import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PalaceStageProgress } from '@/features/palace-catalog/components/palace-list/PalaceStageProgress'
import type { ReviewStageSummary } from '@/shared/api/contracts'

function buildStage(
  reviewNumber: number,
  {
    label = `阶段 ${reviewNumber + 1}`,
    completed = false,
    completedAt = null,
    scheduledAt = null,
  }: {
    label?: string
    completed?: boolean
    completedAt?: string | null
    scheduledAt?: string | null
  } = {},
): ReviewStageSummary {
  return {
    review_number: reviewNumber,
    label,
    completed,
    completed_at: completedAt,
    scheduled_at: scheduledAt,
  }
}

function getWidthPercent() {
  return Number.parseFloat((screen.getByTestId('stage-track-fill') as HTMLElement).style.width)
}

describe('PalaceStageProgress', () => {
  it('invokes the stage callback from the enlarged accessible node target', () => {
    const onStageClick = vi.fn()
    const targetStage = buildStage(1, { label: '1天' })

    render(
      <PalaceStageProgress
        stageLabels={['1小时', '1天']}
        completed={1}
        stages={[buildStage(0, { completed: true }), targetStage]}
        onStageClick={onStageClick}
      />,
    )

    const node = screen.getByRole('button', { name: '1天，未完成，点击调整宫殿复习进度' })
    expect(node.className).toContain('h-8')
    fireEvent.click(node)
    expect(onStageClick).toHaveBeenCalledWith(targetStage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps all nodes gray and leaves the fill empty when no stage is completed', () => {
    render(
      <PalaceStageProgress
        stageLabels={['1小时', '1天']}
        completed={0}
        stages={[
          buildStage(0, { scheduledAt: '2026-05-12T10:00:00' }),
          buildStage(1, { scheduledAt: '2026-05-12T11:00:00' }),
        ]}
      />,
    )

    expect(getWidthPercent()).toBe(0)
    expect(screen.getByTestId('stage-node-0').className).toContain('bg-muted-foreground/30')
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-muted-foreground/30')
  })

  it('fills only within the current segment while keeping the next incomplete node gray', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T11:00:00'))

    render(
      <PalaceStageProgress
        stageLabels={['1小时', '1天', '2天']}
        completed={1}
        stages={[
          buildStage(0, {
            completed: true,
            completedAt: '2026-05-12T10:00:00',
            scheduledAt: '2026-05-12T10:00:00',
          }),
          buildStage(1, { scheduledAt: '2026-05-12T14:00:00' }),
          buildStage(2, { scheduledAt: '2026-05-12T20:00:00' }),
        ]}
      />,
    )

    expect(getWidthPercent()).toBeCloseTo((3 / 12) * 50, 4)
    expect(screen.getByTestId('stage-node-0').className).toContain('bg-info')
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-muted-foreground/30')
  })

  it('keeps the segment empty before the first twelfth is reached', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T10:02:00'))

    render(
      <PalaceStageProgress
        stageLabels={['1小时', '1天', '2天', '4天', '7天', '15天', '30天', '60天', '120天']}
        completed={1}
        stages={[
          buildStage(0, {
            completed: true,
            completedAt: '2026-05-12T10:00:00',
            scheduledAt: '2026-05-12T10:00:00',
          }),
          buildStage(1, { scheduledAt: '2026-05-13T10:00:00' }),
          buildStage(2, { scheduledAt: '2026-05-14T10:00:00' }),
          buildStage(3, { scheduledAt: '2026-05-16T10:00:00' }),
          buildStage(4, { scheduledAt: '2026-05-19T10:00:00' }),
          buildStage(5, { scheduledAt: '2026-05-27T10:00:00' }),
          buildStage(6, { scheduledAt: '2026-06-11T10:00:00' }),
          buildStage(7, { scheduledAt: '2026-07-11T10:00:00' }),
          buildStage(8, { scheduledAt: '2026-09-09T10:00:00' }),
        ]}
      />,
    )

    expect(getWidthPercent()).toBe(0)
    expect(screen.getByTestId('stage-node-0').className).toContain('bg-info')
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-muted-foreground/30')
  })

  it('quantizes a 1.5 hour interval into 12 equal steps based on real elapsed time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T10:50:00'))

    render(
      <PalaceStageProgress
        stageLabels={['1小时', '睡前', '1天']}
        completed={1}
        stages={[
          buildStage(0, {
            completed: true,
            completedAt: '2026-05-12T10:00:00',
            scheduledAt: '2026-05-12T10:00:00',
          }),
          buildStage(1, { scheduledAt: '2026-05-12T11:30:00' }),
          buildStage(2, { scheduledAt: '2026-05-13T10:00:00' }),
        ]}
      />,
    )

    expect(getWidthPercent()).toBeCloseTo((6 / 12) * 50, 4)
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-muted-foreground/30')
  })

  it('fills up to the next node position after its scheduled time without lighting that node', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T15:30:00'))

    render(
      <PalaceStageProgress
        stageLabels={['1小时', '1天', '2天']}
        completed={1}
        stages={[
          buildStage(0, {
            completed: true,
            completedAt: '2026-05-12T10:00:00',
            scheduledAt: '2026-05-12T10:00:00',
          }),
          buildStage(1, { scheduledAt: '2026-05-12T14:00:00' }),
          buildStage(2, { scheduledAt: '2026-05-12T20:00:00' }),
        ]}
      />,
    )

    expect(getWidthPercent()).toBeCloseTo(50, 4)
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-muted-foreground/30')
  })

  it('uses the next review time when the next stage has no scheduled timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-12T15:00:00'))

    render(
      <PalaceStageProgress
        stageLabels={['1小时', '睡前', '1天', '2天', '4天']}
        completed={3}
        nextReviewAt="2026-05-12T14:45:00"
        stages={[
          buildStage(0, { completed: true }),
          buildStage(1, { completed: true }),
          buildStage(2, {
            completed: true,
            scheduledAt: '2026-05-12T14:45:00',
          }),
          buildStage(3),
          buildStage(4),
        ]}
      />,
    )

    expect(getWidthPercent()).toBeCloseTo(75, 4)
    expect(screen.getByTestId('stage-node-3').className).toContain('bg-muted-foreground/30')
  })

  it('keeps nodes evenly spaced regardless of hour differences', () => {
    render(
      <PalaceStageProgress
        stageLabels={['1小时', '5小时', '48小时']}
        completed={1}
        stages={[
          buildStage(0, {
            completed: true,
            completedAt: '2026-05-12T08:00:00',
            scheduledAt: '2026-05-12T08:00:00',
          }),
          buildStage(1, { scheduledAt: '2026-05-12T09:00:00' }),
          buildStage(2, { scheduledAt: '2026-05-12T14:00:00' }),
        ]}
      />,
    )

    const container = screen.getByTestId('stage-node-0').parentElement as HTMLElement
    expect(container.className).toContain('justify-between')
    expect(getWidthPercent()).toBeGreaterThanOrEqual(0)
  })

  it('keeps the current segment empty when stage times are missing or reversed', () => {
    render(
      <PalaceStageProgress
        stageLabels={['A', 'B', 'C']}
        completed={1}
        stages={[
          buildStage(0, {
            completed: true,
            completedAt: '2026-05-12T10:00:00',
            scheduledAt: '2026-05-12T10:00:00',
          }),
          buildStage(1, { scheduledAt: null }),
          buildStage(2, { scheduledAt: '2026-05-12T09:00:00' }),
        ]}
      />,
    )

    expect(getWidthPercent()).toBe(0)
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-muted-foreground/30')
  })

  it('trusts backend stages when they are complete even if completed count disagrees', () => {
    render(
      <PalaceStageProgress
        stageLabels={['A', 'B', 'C']}
        completed={0}
        stages={[
          buildStage(0, { completed: true, completedAt: '2026-05-12T10:00:00', scheduledAt: '2026-05-12T10:00:00' }),
          buildStage(1, { completed: true, completedAt: '2026-05-13T10:00:00', scheduledAt: '2026-05-13T10:00:00' }),
          buildStage(2, { completed: false, scheduledAt: '2026-05-14T10:00:00' }),
        ]}
      />,
    )

    expect(screen.getByTestId('stage-node-0').className).toContain('bg-info')
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-info')
    expect(screen.getByTestId('stage-node-2').className).toContain('bg-muted-foreground/30')
  })

  it('falls back only when backend stages are incomplete', () => {
    render(
      <PalaceStageProgress
        stageLabels={['A', 'B', 'C']}
        completed={1}
        stages={[buildStage(0, { completed: false })]}
      />,
    )

    expect(screen.getByTestId('stage-node-0').className).toContain('bg-info')
    expect(screen.getByTestId('stage-node-1').className).toContain('bg-muted-foreground/30')
    expect(screen.getByTestId('stage-node-2').className).toContain('bg-muted-foreground/30')
  })
})
