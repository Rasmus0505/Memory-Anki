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
}));

export const getDashboardApi = vi.fn();
export const getDashboardHeatmapApi = vi.fn();
export const getRecentReviewNotesApi = vi.fn();
export const getStudyGoalsApi = vi.fn();
export const getWeeklyReportApi = vi.fn();
export const saveStudyGoalsApi = vi.fn();

export const timeRecordsDashboardMock = {
  thresholdInput: "0",
  setThresholdInput: vi.fn(),
  showBelowThreshold: false,
  setShowBelowThreshold: vi.fn(),
  showDeleted: false,
  setShowDeleted: vi.fn(),
  kindFilter: "all" as const,
  setKindFilter: vi.fn(),
  keyword: "",
  setKeyword: vi.fn(),
  sortBy: "started_at" as const,
  setSortBy: vi.fn(),
  sortOrder: "desc" as const,
  setSortOrder: vi.fn(),
  page: 1,
  pageSize: 20,
  totalRecords: 0,
  totalPages: 1,
  setPage: vi.fn(),
  setPageSize: vi.fn(),
  isLoadingRecords: false,
  recordsError: null,
  selectedRecordIds: [],
  dialogMode: "create" as const,
  dialogOpen: false,
  formState: {},
  formError: null,
  isSubmittingRecord: false,
  deletingRecordId: null,
  restoringRecordId: null,
  isBulkDeleting: false,
  trend: [],
  breakdown: [],
  visibleRecords: [],
  hasSelectableRecords: false,
  allSelectableChecked: false,
  hasSelectedRecords: false,
  refreshRecords: vi.fn(),
  applyThreshold: vi.fn(),
  openCreateDialog: vi.fn(),
  openEditDialog: vi.fn(),
  handleDeleteRecord: vi.fn(),
  handleRestoreRecord: vi.fn(),
  toggleRecordSelection: vi.fn(),
  toggleSelectAllVisible: vi.fn(),
  handleBulkDelete: vi.fn(),
  onDialogOpenChange: vi.fn(),
  onFormChange: vi.fn(),
  handleSubmitRecord: vi.fn(),
};

vi.mock("@/features/dashboard/api", () => ({
  getDashboardApi: async (...args: unknown[]) =>
    buildDashboardResponse(await getDashboardApi(...args)),
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
    weekly_study_minutes: 300,
    weekly_review_count: 20,
  },
}));

vi.mock("@/features/profile/hooks/useTimeRecordsDashboard", () => ({
  useTimeRecordsDashboard: (options: {
    trendRange?: 7 | 30 | 90 | "all";
    breakdownRange?: 7 | 30 | 90 | "all";
  }) => ({
    ...timeRecordsDashboardMock,
    trend: [{
      dateKey: `trend-${options.trendRange ?? 7}`,
      label: `trend-${options.trendRange ?? 7}`,
      seconds: 1,
    }],
    breakdown: [{
      kind: "review",
      label: `breakdown-${options.breakdownRange ?? "all"}`,
      seconds: 1,
      sessions: 1,
    }],
  }),
}));

vi.mock("@/features/profile/components/TimeRecordsTrendChart", () => ({
  TimeRecordsTrendChart: ({ trend }: { trend: Array<{ label: string }> }) => (
    <div data-testid="trend-chart">{trend[0]?.label ?? ""}</div>
  ),
}));

vi.mock("@/features/profile/components/TimeRecordsBreakdownChart", () => ({
  TimeRecordsBreakdownChart: ({
    breakdown,
  }: {
    breakdown: Array<{ label: string }>;
  }) => <div data-testid="breakdown-chart">{breakdown[0]?.label ?? ""}</div>,
}));

vi.mock("@/features/profile/components/TimeRecordsTable", () => ({
  TimeRecordsTable: () => <div data-testid="records-table" />,
}));

vi.mock("@/features/profile/components/TimeRecordDialog", () => ({
  TimeRecordDialog: () => null,
}));

export function setupDashboardPageTest() {
  getDashboardApi.mockReset();
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
    study_seconds: 0,
    review_count: 0,
    average_score: 0,
    new_palace_count: 0,
  }));
  saveStudyGoalsApi.mockResolvedValue({ items: {} });
  resetClientPreferenceCacheForTest();
  window.localStorage.clear();
  vi.clearAllMocks();
}

export function renderDashboardPage() {
  return render(<DashboardPage />);
}
