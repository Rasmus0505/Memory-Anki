import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getDashboardApi,
  renderDashboardPage,
  setupDashboardPageTest,
} from "@/pages/insights/InsightsPage.test-support";

describe("DashboardPage charts", () => {
  beforeEach(() => {
    setupDashboardPageTest();
  });

  it("restores independent chart ranges from persisted client preferences", async () => {
    window.localStorage.setItem(
      "memory_anki_dashboard_total_duration_filter",
      JSON.stringify({
        mode: "month",
        month: "2026-06",
        startDate: "",
        endDate: "",
        trendRangeDays: "all",
        breakdownRangeDays: 90,
      }),
    );

    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 1200,
      monthly_total_review_duration_seconds: 7200,
      selected_total_review_duration_seconds: 7200,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1800,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    });

    renderDashboardPage();

    expect(await screen.findByText("全部趋势")).toBeTruthy();
    expect(screen.getByTestId("trend-chart").textContent).toBe("trend-all");
    expect(screen.getByTestId("breakdown-chart").textContent).toBe("breakdown-90");
  });

  it("switches chart ranges independently inside each card", async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 1200,
      monthly_total_review_duration_seconds: 7200,
      selected_total_review_duration_seconds: 7200,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1800,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    });

    renderDashboardPage();

    expect((await screen.findByTestId("trend-chart")).textContent).toBe("trend-7");
    expect(screen.getByTestId("breakdown-chart").textContent).toBe("breakdown-7");

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "30 天" })[0]);
    });

    expect(screen.getByTestId("trend-chart").textContent).toBe("trend-30");
    expect(screen.getByTestId("breakdown-chart").textContent).toBe("breakdown-7");

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "90 天" })[1]);
    });

    expect(screen.getByTestId("trend-chart").textContent).toBe("trend-30");
    expect(screen.getByTestId("breakdown-chart").textContent).toBe("breakdown-90");
  });
});
