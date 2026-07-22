import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_STUDY_GOALS,
  getDashboardApi,
  getDashboardHeatmapApi,
  getRecentReviewNotesApi,
  getStudyGoalsApi,
  getWeeklyReportApi,
  prefetchDashboardApi,
  saveStudyGoalsApi,
} from "@/modules/dashboard/ui/dashboard/api"
import { request } from "@/shared/api/http"

vi.mock("@/shared/api/http", () => ({
  request: vi.fn(),
}))

const requestMock = vi.mocked(request)

describe("dashboard api", () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({})
  })

  it("requests the dashboard endpoint without an empty query string", async () => {
    await getDashboardApi()

    expect(requestMock).toHaveBeenCalledWith("/dashboard")
  })

  it("serializes dashboard query fields", async () => {
    await getDashboardApi({
      duration_mode: "range",
      month: "2026-06",
      start_date: "2026-06-01",
      end_date: "2026-06-18",
    })

    expect(requestMock).toHaveBeenCalledWith(
      "/dashboard?duration_mode=range&month=2026-06&start_date=2026-06-01&end_date=2026-06-18",
    )
  })

  it("reuses a warmed dashboard request exactly once", async () => {
    requestMock.mockResolvedValue({})

    prefetchDashboardApi()
    await getDashboardApi()
    await getDashboardApi()

    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it("requests the dashboard heatmap endpoint", async () => {
    await getDashboardHeatmapApi(30)

    expect(requestMock).toHaveBeenCalledWith("/dashboard/heatmap?days=30")
  })

  it("requests weekly report for the provided offset", async () => {
    await getWeeklyReportApi(0)

    expect(requestMock).toHaveBeenCalledWith("/dashboard/weekly-report?offset_weeks=0")
  })

  it("reads study goals from client preferences", async () => {
    requestMock.mockResolvedValue({
      items: {
        study_goals: {
          weekly_study_minutes: 60,
          weekly_review_count: 7,
        },
      },
    })

    await expect(getStudyGoalsApi()).resolves.toEqual({
      weekly_study_minutes: 60,
      weekly_review_count: 7,
    })
    expect(requestMock).toHaveBeenCalledWith("/profile/client-preferences")
  })

  it("saves study goals to client preferences", async () => {
    await saveStudyGoalsApi(DEFAULT_STUDY_GOALS)

    expect(requestMock).toHaveBeenCalledWith("/profile/client-preferences", {
      method: "PUT",
      body: JSON.stringify({ study_goals: DEFAULT_STUDY_GOALS }),
      persistence: {
        resourceKey: "preferences:study-goals",
        coalesceKey: "preferences:study-goals",
        description: "保存学习目标",
        replayMode: "auto",
      },
    })
  })

  it("requests recent review notes with a limit", async () => {
    await getRecentReviewNotesApi(5)

    expect(requestMock).toHaveBeenCalledWith("/review/notes?limit=5")
  })
})
