import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getDashboardApi,
  renderDashboardPage,
  setupDashboardPageTest,
} from "@/features/dashboard/DashboardPage.test-support";

describe("DashboardPage filters", () => {
  beforeEach(() => {
    setupDashboardPageTest();
  });

  it("uses current month by default and does not request selected duration again without persisted filters", async () => {
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

    expect(await screen.findByLabelText("选择月份")).toBeTruthy();
    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledTimes(1);
    });
    expect(getDashboardApi).toHaveBeenCalledWith();
  });

  it("restores persisted month filter on reopen", async () => {
    window.localStorage.setItem(
      "memory_anki_dashboard_total_duration_filter",
      JSON.stringify({
        mode: "month",
        month: "2026-05",
        startDate: "",
        endDate: "",
      }),
    );

    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string; month?: string }) => {
      if (query?.duration_mode === "month" && query.month === "2026-05") {
        return {
          due_count: 0,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 3600,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        };
      }
      return {
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
      };
    });

    renderDashboardPage();

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: "month",
        month: "2026-05",
      });
    });
    expect((screen.getByLabelText("选择月份") as HTMLInputElement).value).toBe("2026-05");
    expect(screen.getByText("2026-05")).toBeTruthy();
  });

  it("restores persisted custom range filter on reopen", async () => {
    window.localStorage.setItem(
      "memory_anki_dashboard_total_duration_filter",
      JSON.stringify({
        mode: "range",
        month: "2026-06",
        startDate: "2026-06-01",
        endDate: "2026-06-15",
      }),
    );

    getDashboardApi.mockImplementation(
      async (query?: { duration_mode?: string; start_date?: string; end_date?: string }) => {
        if (
          query?.duration_mode === "range" &&
          query.start_date === "2026-06-01" &&
          query.end_date === "2026-06-15"
        ) {
          return {
            due_count: 0,
            reviews: [],
            stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
            today_review_duration_seconds: 0,
            weekly_review_duration_seconds: 0,
            today_total_review_duration_seconds: 1200,
            monthly_total_review_duration_seconds: 7200,
            selected_total_review_duration_seconds: 1800,
            weekly_total_review_duration_seconds: 3600,
            weekly_formal_review_duration_seconds: 1800,
            recent_palaces: [],
            today_learning_palaces: [],
            today_new_palace_count: 0,
            today_new_palaces: [],
          };
        }
        return {
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
        };
      },
    );

    renderDashboardPage();

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: "range",
        start_date: "2026-06-01",
        end_date: "2026-06-15",
      });
    });
    expect((screen.getByLabelText("开始日期") as HTMLInputElement).value).toBe("2026-06-01");
    expect((screen.getByLabelText("结束日期") as HTMLInputElement).value).toBe("2026-06-15");
    expect(screen.getByText("2026-06-01 至 2026-06-15")).toBeTruthy();
  });

  it("restores persisted all filter on reopen and hides date inputs", async () => {
    window.localStorage.setItem(
      "memory_anki_dashboard_total_duration_filter",
      JSON.stringify({
        mode: "all",
        month: "2026-06",
        startDate: "2026-06-01",
        endDate: "2026-06-15",
      }),
    );

    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string }) => {
      if (query?.duration_mode === "all") {
        return {
          due_count: 0,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 9600,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        };
      }
      return {
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
      };
    });

    renderDashboardPage();

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: "all",
      });
    });
    expect(screen.getByRole("button", { name: "显示全部" })).toBeTruthy();
    expect(screen.queryByLabelText("选择月份")).toBeNull();
    expect(screen.queryByLabelText("开始日期")).toBeNull();
    expect(screen.queryByLabelText("结束日期")).toBeNull();
  });

  it("falls back to default current month when persisted filter is invalid", async () => {
    window.localStorage.setItem(
      "memory_anki_dashboard_total_duration_filter",
      '{"mode":"weekly","month":5}',
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

    const monthInput = await screen.findByLabelText("选择月份");
    expect((monthInput as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}$/);
    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledTimes(1);
    });
  });

  it("requests selected total duration for a different month", async () => {
    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string; month?: string }) => {
      if (query?.duration_mode === "month" && query.month === "2026-05") {
        return {
          due_count: 1,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 3600,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        };
      }
      return {
        due_count: 1,
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
      };
    });

    renderDashboardPage();

    const monthInput = await screen.findByLabelText("选择月份");
    fireEvent.change(monthInput, { target: { value: "2026-05" } });

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: "month",
        month: "2026-05",
      });
    });
    expect(screen.getByText("2026-05")).toBeTruthy();
    expect(screen.getByLabelText("选择月份")).toBeTruthy();
  });

  it("requests selected total duration for a custom range", async () => {
    getDashboardApi.mockImplementation(
      async (query?: { duration_mode?: string; start_date?: string; end_date?: string }) => {
        if (
          query?.duration_mode === "range" &&
          query.start_date === "2026-06-01" &&
          query.end_date === "2026-06-15"
        ) {
          return {
            due_count: 0,
            reviews: [],
            stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
            today_review_duration_seconds: 0,
            weekly_review_duration_seconds: 0,
            today_total_review_duration_seconds: 1200,
            monthly_total_review_duration_seconds: 7200,
            selected_total_review_duration_seconds: 1800,
            weekly_total_review_duration_seconds: 3600,
            weekly_formal_review_duration_seconds: 1800,
            recent_palaces: [],
            today_learning_palaces: [],
            today_new_palace_count: 0,
            today_new_palaces: [],
          };
        }
        return {
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
        };
      },
    );

    renderDashboardPage();

    fireEvent.click(await screen.findByRole("button", { name: "自定义范围" }));
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("结束日期"), {
      target: { value: "2026-06-15" },
    });

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: "range",
        start_date: "2026-06-01",
        end_date: "2026-06-15",
      });
    });
    expect(await screen.findByText("30分 0秒")).toBeTruthy();
    expect(screen.getByText("2026-06-01 至 2026-06-15")).toBeTruthy();
  });

  it("requests selected total duration for all history and hides filter inputs", async () => {
    getDashboardApi.mockImplementation(
      async (query?: {
        duration_mode?: string;
        month?: string;
        start_date?: string;
        end_date?: string;
      }) => {
        if (query?.duration_mode === "all") {
          return {
            due_count: 0,
            reviews: [],
            stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
            today_review_duration_seconds: 0,
            weekly_review_duration_seconds: 0,
            today_total_review_duration_seconds: 1200,
            monthly_total_review_duration_seconds: 7200,
            selected_total_review_duration_seconds: 9600,
            weekly_total_review_duration_seconds: 3600,
            weekly_formal_review_duration_seconds: 1800,
            recent_palaces: [],
            today_learning_palaces: [],
            today_new_palace_count: 0,
            today_new_palaces: [],
          };
        }
        return {
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
        };
      },
    );

    renderDashboardPage();

    fireEvent.click(await screen.findByRole("button", { name: "显示全部" }));

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: "all",
      });
    });
    expect(await screen.findByText("2小时 40分")).toBeTruthy();
    expect(screen.getByRole("button", { name: "显示全部" })).toBeTruthy();
    expect(screen.queryByLabelText("选择月份")).toBeNull();
    expect(screen.queryByLabelText("开始日期")).toBeNull();
    expect(screen.queryByLabelText("结束日期")).toBeNull();
  });

  it("preserves entered filters when switching back from all mode", async () => {
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

    const monthInput = await screen.findByLabelText("选择月份");
    fireEvent.change(monthInput, { target: { value: "2026-05" } });
    fireEvent.click(screen.getByRole("button", { name: "自定义范围" }));
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("结束日期"), {
      target: { value: "2026-06-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "显示全部" }));

    expect(screen.queryByLabelText("选择月份")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "月份" }));
    expect((screen.getByLabelText("选择月份") as HTMLInputElement).value).toBe("2026-05");

    fireEvent.click(screen.getByRole("button", { name: "自定义范围" }));
    expect((screen.getByLabelText("开始日期") as HTMLInputElement).value).toBe("2026-06-01");
    expect((screen.getByLabelText("结束日期") as HTMLInputElement).value).toBe("2026-06-15");
    await waitFor(() => {
      expect(getDashboardApi.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("does not request custom range duration when dates are invalid", async () => {
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

    expect(await screen.findByRole("button", { name: "显示全部" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "自定义范围" }));
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-06-20" },
    });
    fireEvent.change(screen.getByLabelText("结束日期"), {
      target: { value: "2026-06-10" },
    });

    expect(screen.getByText("开始日期不能晚于结束日期。")).toBeTruthy();
    expect(getDashboardApi).toHaveBeenCalledTimes(1);
  });
});
