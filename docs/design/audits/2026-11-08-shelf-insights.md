# Impeccable 技术审查：学科书架 / 洞察

> `/impeccable audit` 的产物：只记录问题，不在本轮修。修复由后续 `harden` / `polish` / `adapt` 承担。
> 目标：`/palaces`（学科书架）与 `/dashboard`（洞察），1440×900 与 390×844，浅色 + 深色。
> 证据：`impeccable detect`、Playwright 实测（滚动宽度、触控目标、可访问名称、标题层级）、token 对比度计算。
> 日期：2026-11-08。

## 健康分

| # | 维度 | 分数 | 关键发现 |
|---|---|---|---|
| 1 | Accessibility | 3 | 书架搜索框只有 placeholder，没有 `aria-label` / `<label>`（唯一一个无名称的可聚焦元素） |
| 2 | Performance | 3 | 生产包有 >500kB 的单块（历史问题）；字体自托管、无外部 CDN；动效以 transform/opacity 为主 |
| 3 | Theming | 4 | 颜色、字体、圆角、阴影全部走 token；深浅两套完整；仅少数做题内部组件还保留 Tailwind 调色板 |
| 4 | Responsive Design | 4 | 390 与 1440 均无横向溢出；触控目标均 ≥24px（窄高元素均为行内文字链接，属 WCAG 2.5.8 豁免） |
| 5 | Implementation Integrity | 4 | 界面语言明确属于本产品；检测器仅剩 2 条警告，均有明确语境（图例虚线、遮答案渐变） |
| **总分** | | **18/20** | **Excellent（只欠小修）** |

## 实现完整性结论

通过。书架是目录式索引、洞察是“今日学案 + 账本”，两者共享暖纸、衬线数字与发丝线，不是可套用到任意 SaaS 的模板。检测器没有发现系统性漂移。

## 详细发现

### [P1] 书架搜索框没有可访问名称

- 位置：`PalaceShelfPage.tsx` 的搜索 `Input`（placeholder「搜索学科或宫殿...」）。
- 类别：Accessibility（WCAG 1.3.1 / 4.1.2）。
- 影响：屏幕阅读器只读出“编辑框”，不知道搜什么；语音控制也无法用名称定位。
- 建议：加 `aria-label="搜索学科或宫殿"`，placeholder 只做提示。
- 建议命令：`/impeccable harden`。

### [P2] 洞察页 12 个行内链接高度 20px

- 位置：`ExamTodayBlock` 的宫殿链接、`ExamWeakList` 的标题链接、「作战室 →」。
- 类别：Responsive / Accessibility。
- 影响：手指点按容易落空；但它们是行内文字链接，WCAG 2.5.8 明确豁免。
- 建议：行内链接保持现状；如需改善，给手机端加 `py-1` 的点击留白（不改变视觉行高）。
- 建议命令：`/impeccable adapt`。

### [P2] 深色热力图最亮一档偏亮

- 位置：`StudyHeatmap.tsx` 的 `bg-success`（深色 `#69bf9f`）。
- 类别：Theming。
- 影响：在熄灯桌面上，最活跃的一天比周围亮很多，会把视线从“今天该学什么”拉走。
- 建议：深色下把最高一档降到 `bg-success/85`，或在 token 层用 `--color-success` 的 80%。
- 建议命令：`/impeccable quieter`。

### [P3] 书架“全部收起”图标与搜索行分离

- 位置：`PalaceShelfPage.tsx` 搜索行右侧的独立按钮。
- 类别：Layout。
- 影响：视觉上像浮在空白里；功能不受影响。
- 建议：与搜索框同一行并对齐右端，或在标题动作组里。
- 建议命令：`/impeccable layout`。

## 正向发现

- 390 与 1440 均无横向滚动（`scrollWidth === innerWidth`）。
- 标题层级正确：洞察只有 1 个 H1，其后 H2/H3；书架只有 1 个 H1。
- 所有图片都有 alt；除搜索框外，所有可聚焦元素都有可访问名称。
- 深色不是浅色的反相，而是重新取样的暖黑；对比度 7.06:1（次级字）到 15.96:1（正文）。
- 书架把“学科色”降为 8px 方标，不靠大面积色块区分，长列表仍然安静。

## 建议顺序

1. [P1] `/impeccable harden`：补搜索框可访问名称。
2. [P2] `/impeccable quieter`：压一档深色热力图。
3. [P2] `/impeccable adapt`：手机端行内链接点击留白。
4. [P3] `/impeccable layout`：书架工具按钮归位。
5. 最后 `/impeccable polish`。
