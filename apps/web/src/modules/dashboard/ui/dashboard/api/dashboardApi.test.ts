import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getDashboardApi,
  getDashboardHeatmapApi,
  getStudyGoalsApi,
  getWeeklyReportApi,
  invalidateDashboardApi,
  prefetchDashboardApi,
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

  it("reuses a warmed dashboard request exactly once", async () => {
    requestMock.mockResolvedValue({})

    prefetchDashboardApi()
    await getDashboardApi()
    await getDashboardApi()

    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it("invalidates all warmed dashboard requests", async () => {
    prefetchDashboardApi()
    invalidateDashboardApi()
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
          weekly_review_count: 7,
        },
      },
    })

    await expect(getStudyGoalsApi()).resolves.toEqual({
      weekly_review_count: 7,
    })
    expect(requestMock).toHaveBeenCalledWith("/profile/client-preferences")
  })
})
