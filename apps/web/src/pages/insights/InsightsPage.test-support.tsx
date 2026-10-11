import * as React from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import DashboardPage from "@/pages/insights/InsightsPage";
import { buildDashboardResponse } from "@/pages/insights/InsightsPage.test-utils";
import { resetClientPreferenceCacheForTest } from "@/shared/preferences/clientPreferences";

vi.mock("react-router-dom", () => ({
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
  }) => <a href={to}>{children}</a>,
  NavLink: ({
    children,
    to,
    className,
    title,
    "aria-current": ariaCurrent,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
    title?: string;
    "aria-current"?: "page" | undefined;
  }) => (
    <a href={to} className={className} title={title} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/dashboard", search: "", hash: "" }),
}));

export const getDashboardApi = vi.fn();
export const invalidateDashboardApi = vi.fn();
export const getDashboardHeatmapApi = vi.fn();
export const getRecentReviewNotesApi = vi.fn();
export const getStudyGoalsApi = vi.fn();
export const getWeeklyReportApi = vi.fn();
export const saveStudyGoalsApi = vi.fn();
export const examOverviewState: { data: unknown; error: string | null } = { data: null, error: null };

vi.mock("@/modules/dashboard/ui/dashboard/api", () => ({
  getDashboardApi: async (...args: unknown[]) =>
    buildDashboardResponse(await getDashboardApi(...args)),
  invalidateDashboardApi: (...args: unknown[]) => invalidateDashboardApi(...args),
  getDashboardHeatmapApi: async (...args: unknown[]) =>
    getDashboardHeatmapApi(...args),
  getRecentReviewNotesApi: async (...args: unknown[]) =>
    getRecentReviewNotesApi(...args),
  getStudyGoalsApi: async (...args: unknown[]) =>
    getStudyGoalsApi(...args),
  getWeeklyReportApi: async (...args: unknown[]) =>
    getWeeklyReportApi(...args),
  saveStudyGoalsApi: async (...args: unknown[]) =>
    saveStudyGoalsApi(...args),
  DEFAULT_STUDY_GOALS: {
    weekly_review_count: 20,
  },
}));

vi.mock("@/modules/exam/model/useExamOverview", () => ({
  useExamOverview: () => ({ ...examOverviewState, reload: vi.fn(), setData: vi.fn() }),
}));

export function setupDashboardPageTest() {
  getDashboardApi.mockReset();
  invalidateDashboardApi.mockReset();
  getDashboardHeatmapApi.mockReset();
  getRecentReviewNotesApi.mockReset();
  getStudyGoalsApi.mockReset();
  getWeeklyReportApi.mockReset();
  saveStudyGoalsApi.mockReset();
  getDashboardHeatmapApi.mockResolvedValue({
    start_date: "2026-01-08",
    end_date: "2026-07-08",
    items: [],
    current_streak: 0,
    longest_streak: 0,
    active_day_count: 0,
  });
  getRecentReviewNotesApi.mockResolvedValue({ items: [] });
  getStudyGoalsApi.mockResolvedValue(null);
  getWeeklyReportApi.mockImplementation(async (offsetWeeks = 1) => ({
    week_start: offsetWeeks === 0 ? "2026-07-06" : "2026-06-29",
    week_end: offsetWeeks === 0 ? "2026-07-12" : "2026-07-05",
    review_count: 0,
    average_score: 0,
    new_palace_count: 0,
  }));
  saveStudyGoalsApi.mockResolvedValue({ items: {} });
  examOverviewState.data = null;
  examOverviewState.error = null;
  resetClientPreferenceCacheForTest();
  window.localStorage.clear();
  vi.clearAllMocks();
}

export function renderDashboardPage() {
  return render(<DashboardPage />);
}
