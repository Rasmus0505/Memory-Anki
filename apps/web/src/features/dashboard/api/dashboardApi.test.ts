import { beforeEach, describe, expect, it, vi } from "vitest"
import { getDashboardApi, prefetchDashboardApi } from "@/features/dashboard/api"
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
})
