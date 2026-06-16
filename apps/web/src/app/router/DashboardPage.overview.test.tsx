import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDashboardApi,
  renderDashboardPage,
  setupDashboardPageTest,
} from "@/app/router/DashboardPage.test-support";

describe("DashboardPage overview", () => {
  beforeEach(() => {
    setupDashboardPageTest();
  });

  it("renders learning breakdown and today new palace hierarchy", async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 2,
      due_later_today_count: 1,
      needs_practice_count: 3,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 5400,
      monthly_total_review_duration_seconds: 14400,
      selected_total_review_duration_seconds: 14400,
      weekly_total_review_duration_seconds: 7200,
      weekly_formal_review_duration_seconds: 3600,
      recent_palaces: [],
      today_learning_palaces: [
        {
          palace_id: 1,
          palace_title: "第五节 陈鹤琴的“活教育”探索",
          total_seconds: 3600,
          review_seconds: 1200,
          practice_seconds: 900,
          palace_edit_seconds: 1500,
        },
      ],
      today_new_palace_count: 2,
      today_new_palaces: [
        {
          subject: { id: 1, name: "中国教育史", color: "#6366f1" },
          chapter_groups: [
            {
              source_chapter: {
                id: 10,
                name: "第五章 现代教育实验",
                subject_id: 1,
                parent_id: null,
              },
              palaces: [
                {
                  id: 1,
                  title: "第五节 陈鹤琴的“活教育”探索",
                  created_at: "2026-05-23T09:00:00",
                  primary_chapter: {
                    id: 11,
                    name: "第五节",
                    subject_id: 1,
                    parent_id: 10,
                  },
                  resolved_parent_chapter: {
                    id: 10,
                    name: "第五章 现代教育实验",
                    subject_id: 1,
                    parent_id: null,
                  },
                },
              ],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    });

    renderDashboardPage();

    expect(await screen.findByText("今日学习")).toBeTruthy();
    expect(screen.getByText("英语")).toBeTruthy();
    expect(screen.getByText("宫殿编辑")).toBeTruthy();
    expect(screen.getByText("练习")).toBeTruthy();
    expect(screen.getByText("复习")).toBeTruthy();
    expect(screen.getAllByText("第五节 陈鹤琴的“活教育”探索").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1小时 0分").length).toBeGreaterThan(0);
    expect(screen.getByText("新增章节数量：2")).toBeTruthy();
    expect(screen.getByText("第五章 现代教育实验")).toBeTruthy();
    expect(screen.queryByText("第五节")).toBeNull();
    expect(screen.getByText("总时长")).toBeTruthy();
    expect(screen.getByText("4小时 0分")).toBeTruthy();
    expect(screen.getByText("本周时长")).toBeTruthy();
    expect(screen.getByDisplayValue(/\d{4}-\d{2}/)).toBeTruthy();
  });

  it("renders dashboard triage counts and review link gating", async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 2,
      due_later_today_count: 1,
      needs_practice_count: 4,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 5400,
      monthly_total_review_duration_seconds: 14400,
      selected_total_review_duration_seconds: 14400,
      weekly_total_review_duration_seconds: 7200,
      weekly_formal_review_duration_seconds: 3600,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    });

    renderDashboardPage();

    expect(await screen.findByText("今日待处理")).toBeTruthy();
    expect(screen.getByText("立即复习")).toBeTruthy();
    expect(screen.getByText("今日稍后")).toBeTruthy();
    expect(screen.getByText("要练习")).toBeTruthy();
    expect(screen.getByRole("link", { name: /开始复习/i })).toBeTruthy();
  });

  it("shows learning tooltip immediately on hover", async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      due_later_today_count: 0,
      needs_practice_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 3600,
      monthly_total_review_duration_seconds: 5400,
      selected_total_review_duration_seconds: 5400,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1200,
      recent_palaces: [],
      today_learning_palaces: [
        {
          palace_id: 8,
          palace_title: "第四节 梁漱溟的乡村教育建设",
          total_seconds: 1800,
          review_seconds: 600,
          practice_seconds: 300,
          palace_edit_seconds: 900,
        },
      ],
      today_new_palace_count: 0,
      today_new_palaces: [],
    });

    renderDashboardPage();

    const progressBar = await screen.findByRole("img", {
      name: "第四节 梁漱溟的乡村教育建设 学习时长结构",
    });
    act(() => {
      fireEvent.mouseEnter(progressBar);
    });

    expect(screen.getByText("总时长：30分 0秒")).toBeTruthy();
    expect(screen.getByText("宫殿编辑：15分 0秒")).toBeTruthy();
    expect(screen.getByText("练习：5分 0秒")).toBeTruthy();
    expect(screen.getByText("复习：10分 0秒")).toBeTruthy();
  });

  it("renders empty states for both middle cards", async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 0,
      monthly_total_review_duration_seconds: 0,
      selected_total_review_duration_seconds: 0,
      weekly_total_review_duration_seconds: 0,
      weekly_formal_review_duration_seconds: 0,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    });

    renderDashboardPage();

    expect(await screen.findByText("今天还没有产生学习时长记录。")).toBeTruthy();
    expect(screen.getByText("今天还没有新增记忆宫殿。")).toBeTruthy();
  });
});
