import * as React from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import DashboardPage from "@/app/router/DashboardPage";
import { buildDashboardResponse } from "@/app/router/DashboardPage.test-utils";
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
  selectedRecordIds: [],
  dialogMode: "create" as const,
  dialogOpen: false,
  formState: {},
  formError: null,
  isSubmittingRecord: false,
  deletingRecordId: null,
  restoringRecordId: null,
  isBulkDeleting: false,
  summary: {},
  trend: [],
  breakdown: [],
  getTrendForRange: vi.fn((range: 7 | 30 | 90 | "all") => [
    { dateKey: `trend-${range}`, label: `trend-${range}`, seconds: 1 },
  ]),
  getBreakdownForRange: vi.fn((range: 7 | 30 | 90 | "all") => [
    { kind: "review", label: `breakdown-${range}`, seconds: 1, sessions: 1 },
  ]),
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

vi.mock("@/shared/api/modules/dashboard", () => ({
  getDashboardApi: async (...args: unknown[]) =>
    buildDashboardResponse(await getDashboardApi(...args)),
}));

vi.mock("@/features/profile/hooks/useTimeRecordsDashboard", () => ({
  useTimeRecordsDashboard: () => timeRecordsDashboardMock,
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
  resetClientPreferenceCacheForTest();
  window.localStorage.clear();
  vi.clearAllMocks();
}

export function renderDashboardPage() {
  return render(<DashboardPage />);
}
