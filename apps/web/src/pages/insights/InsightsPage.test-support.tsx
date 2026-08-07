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

export const timeRecordsDashboardMock = {
  filter: {
    version: 2 as const,
    rangeMode: "month" as const,
    month: "2026-07",
    rollingDays: 30 as const,
    startDate: "",
    endDate: "",
    keyword: "",
    kind: "all" as const,
    sortBy: "started_at" as const,
    sortOrder: "desc" as const,
    pageSize: 20,
  },
  setRangeMode: vi.fn(),
  setMonth: vi.fn(),
  setRollingDays: vi.fn(),
  setStartDate: vi.fn(),
  setEndDate: vi.fn(),
  kindFilter: "all" as const,
  setKindFilter: vi.fn(),
  keyword: "",
  setKeyword: vi.fn(),
  sortBy: "started_at" as const,
  setSortBy: vi.fn(),
  sortOrder: "desc" as const,
  setSortOrder: vi.fn(),
  sourceSummary: {
    totalEffectiveSeconds: 267350,
    desktopEffectiveSeconds: 222979,
    pwaEffectiveSeconds: 44371,
    unknownEffectiveSeconds: 0,
  },
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
  customTags: [],
  quickAddOpen: false,
  quickAddForm: {
    tagId: 'review',
    minutes: '30',
    date: '2026-07-21',
    title: '',
    titleEdited: false,
    showAdvanced: false,
    startedAt: '',
    endedAt: '',
  },
  quickAddError: null,
  isSubmittingQuickAdd: false,
  onQuickAddOpenChange: vi.fn(),
  onQuickAddFormChange: vi.fn(),
  onCustomTagsChange: vi.fn(),
  handleSubmitQuickAdd: vi.fn(),
  handleReplayPendingRecovery: vi.fn(),
  handleDismissPendingRecovery: vi.fn(),
  pendingRecoveryRecords: [],
};

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
    weekly_study_minutes: 300,
    weekly_review_count: 20,
  },
}));

vi.mock("@/modules/session/ui/time-records/hooks/useTimeRecordsDashboard", () => ({
  useTimeRecordsDashboard: () => ({
    ...timeRecordsDashboardMock,
    trend: [{
      dateKey: "2026-07-01",
      label: "7/1",
      seconds: 1,
    }],
    breakdown: [{
      kind: "review",
      label: "复习",
      seconds: 1,
      sessions: 1,
    }],
  }),
}));

vi.mock("@/modules/session/ui/time-records/components/TimeRecordsTrendChart", () => ({
  TimeRecordsTrendChart: ({ trend }: { trend: Array<{ label: string }> }) => (
    <div data-testid="trend-chart">{trend[0]?.label ?? ""}</div>
  ),
}));

vi.mock("@/modules/session/ui/time-records/components/TimeRecordsBreakdownChart", () => ({
  TimeRecordsBreakdownChart: ({
    breakdown,
  }: {
    breakdown: Array<{ label: string }>;
  }) => <div data-testid="breakdown-chart">{breakdown[0]?.label ?? ""}</div>,
}));

vi.mock("@/modules/session/ui/time-records/components/TimeRecordsTable", () => ({
  TimeRecordsTable: ({ filter }: { filter: { rangeMode: string; month: string } }) => (
    <div data-testid="records-table">{filter.rangeMode}:{filter.month}</div>
  ),
}));

vi.mock("@/modules/session/ui/time-records/components/TimeRecordDialog", () => ({
  TimeRecordDialog: () => null,
}));

vi.mock("@/modules/session/ui/time-records/components/TimeRecordQuickAddDialog", () => ({
  TimeRecordQuickAddDialog: () => null,
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
