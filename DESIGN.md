---
name: Memory Anki
description: 考研记忆宫殿与 FSRS 翻卡 —— 纸与灯的学习书桌
colors:
  paper-page: "#f6f4ef"
  paper-card: "#fdfcfa"
  ink: "#1c1a17"
  ink-muted: "#6e695e"
  pine-primary: "#22584d"
  pine-soft: "#e2eeeb"
  cinnabar-mark: "#b6422b"
  moss-success: "#2c6d55"
  ochre-warning: "#a76d1b"
  indigo-info: "#2e5c8a"
  paper-border: "#d8d3cb"
  paper-input: "#bcb6a9"
  night-page: "#0e0f11"
  night-card: "#151719"
  night-ink: "#edeae3"
  night-muted: "#a19d91"
  moon-primary: "#79c3b1"
  night-primary-soft: "#1b2c29"
  night-mark: "#e28265"
  night-border: "#2a2e32"
  stage-black: "#12110f"
  stage-ink: "#f1efe9"
  lamplight: "#e2b05a"
typography:
  display:
    fontFamily: "Noto Serif SC Variable, Source Han Serif SC, Songti SC, STSong, SimSun, ui-serif, Georgia, serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.01em"
  page-title:
    fontFamily: "Noto Serif SC Variable, Songti SC, SimSun, ui-serif, Georgia, serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  figure:
    fontFamily: "Noto Serif SC Variable, ui-serif, Georgia, serif"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Noto Sans SC Variable, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Noto Sans SC Variable, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.pine-primary}"
    textColor: "#f7f4ec"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "36px"
  button-primary-dark:
    backgroundColor: "{colors.moon-primary}"
    textColor: "#071310"
  button-outline:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "36px"
  card:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
  input:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "36px"
  nav-current:
    backgroundColor: "{colors.pine-primary}"
    textColor: "#f7f4ec"
    rounded: "{rounded.md}"
    height: "40px"
  stage-panel:
    backgroundColor: "#1a1916"
    textColor: "{colors.stage-ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
---

# Design System: Memory Anki

## Overview

**Creative North Star: 「纸与灯」**

白天是一张摊开的纸：暖白纸面、墨色字、青松色的主操作、朱砂色的批改痕迹。  
夜里是一间只开一盏灯的书房：近黑的桌面、米白的字、琥珀色的灯与行动按钮。  
界面不是“深色模式 + 浅色模式”两套皮肤，而是同一种学习场景在不同光照下的两种呈现。

密度上，阅读与统计界面用横线分组的“账本行”，长时间操作的翻卡与导图则把界面退到边缘；两者共享同一套纸、墨、线、字。气质是克制的学术感，不是游戏化，也不是企业 SaaS。

**Key Characteristics:**

- 暖纸 / 暖黑两种纸面，纸纹与顶部柔光只铺在页面底层。
- 中文衬线承担标题与大数字，无衬线承担操作与正文。
- 松墨（Pine）是主色，朱砂（Cinnabar）只用于截止、遗忘与需要批改的地方。
- 1px 发丝线、12px 卡片圆角、8px 控件圆角；阴影是纸抬起，不是发光。
- 一个场景只安排一次有编排的动效。

## Colors

颜色策略是**克制**：中性色全部从纸与墨里调出来，只保留一个主色和一个批改色；状态色只做语义。

### Light — 纸

| Token | 值 | 用途 |
|---|---|---|
| `--color-background` | `#f6f4ef` | 纸面底色 |
| `--color-card` | `#fdfcfa` | 抬起的纸 |
| `--color-foreground` | `#1c1a17` | 墨 |
| `--color-muted-foreground` | `#6e695e` | 次级墨（对纸 4.96:1） |
| `--color-primary` | `#22584d` | 松墨：主按钮、选中、焦点 |
| `--color-primary-soft` | `#e2eeeb` | 松墨淡底 |
| `--color-mark` | `#b6422b` | 朱砂：截止、遗忘、待批改 |
| `--color-success` | `#2c6d55` | 苔绿 |
| `--color-warning` | `#a76d1b` | 赭黄 |
| `--color-info` | `#2e5c8a` | 靛蓝 |
| `--color-border` | `#d8d3cb` | 发丝线 |
| `--color-input` | `#bcb6a9` | 输入框边 |

### Dark — 灯

| Token | 值 | 用途 |
|---|---|---|
| `--color-background` | `#0e0f11` | 熄灯的桌面 |
| `--color-card` | `#151719` | 桌面上的纸 |
| `--color-foreground` | `#edeae3` | 米白字 |
| `--color-muted-foreground` | `#a19d91` | 次级字（对桌面 7.06:1） |
| `--color-primary` | `#79c3b1` | 月光青：深色下的主操作 |
| `--color-primary-soft` | `#1b2c29` | 深色选中底 |
| `--color-mark` | `#e28265` | 朱砂（提亮） |
| `--color-success` | `#69bf9f` | 苔绿（提亮） |
| `--color-warning` | `#d8aa5a` | 灯光琥珀 |
| `--color-border` | `#2a2e32` | 深色发丝线 |

### Stage — 不跟随主题

| Token | 值 | 用途 |
|---|---|---|
| `--color-stage` | `#12110f` | 沉浸舞台暖黑 |
| `--color-stage-raised` | `#1a1916` | 舞台上的纸 |
| `--color-stage-ink` | `#f1efe9` | 舞台米白字 |
| `--color-stage-glow` | `#e2b05a` | 灯色强调与主按钮 |

评分四色：`rate-again` 朱砂、`rate-hard` 赭黄、`rate-good` 苔绿、`rate-easy` 靛蓝；浅深两套同义。  
学科色 `subject-1…6`：靛、青、苔、梅、锈、赭，低饱和，可并排出现。

## Typography

- **Display / 页面标题**：Noto Serif SC（自托管 variable），26–32px，600，字距 `0.01em`。中文标题承担分层，不用全大写英文小标题。
- **Figure / 数字**：同一衬线 + `tabular-nums lining-nums`，44–62px，用于今日到期、掌握率、复习点总数、翻卡结果。工具类 `.ma-figure`。
- **Body**：Noto Sans SC，14px / 1.65；卡片说明 12–13px，用次级墨。
- **Label**：12px / 500，字距 `0.02em`；用于统计标签、表单标签、导航。
- 正文测量宽度 65–75 字符；页面标题区下有一条发丝线。
- 字体只从项目自身文件加载，不引用外部字体 CDN。

## Layout

- **外壳**：左侧书脊 248px（收起 60px），贴住窗口左缘，1px 右发丝线，无圆角、无悬浮。手机换成底部标签栏。
- **内容**：最大 1600px；页面内边距桌面 24–36px、手机 8–12px；常规页 1024px、宽页 1280px。
- **节奏**：卡片间距 12px；标题上方留白大于下方；成组信息用横线分行的账本，而不是层层小卡片。
- **书架**：目录式索引；学科名衬线 17px，行高 48–52px，右侧衬线计数。
- **洞察**：开头是不带卡片的“今日学案”（日期、巨大数字、三条最该学的宫殿），其余才是卡片。
- **随心开始**：桌面两栏（待复习 / 第一次学 ｜ 里程碑 / 昨日回顾），手机单栏，开始按钮横跨底部。
- **响应式**：768px 以下隐藏左侧栏；1024px 以上可收起；沉浸页在手机上隐藏底部栏。

## Elevation & Depth

纸抬起的深度，不是发光：

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-soft` | 1px 接触线 + 极淡墨 | 小控件、贴纸 |
| `--shadow-card` | 1px 接触线 + 大范围淡墨 | 普通卡片 |
| `--shadow-popover` | 1px 环 + 中距投影 | 下拉、气泡 |
| `--shadow-floating` | 1px 环 + 远距大投影 | 大对话框 |
| `--shadow-lift` | 悬停抬起 | 可点卡片 |
| `--shadow-glow` | 主色环 + 柔光 | 主按钮 / 焦点 |

深色用 1px 顶部高光 + 更深的黑；禁止零偏移彩色光晕。页面底层叠一层 3.5% 的纸纹和一层顶部柔光（`--ma-page-wash`），卡片不再重复纹理。

## Shapes

- 控件 8px，卡片 12px，大浮层 18px；小标签 4px。
- 1px 发丝线是主要分隔手段；分隔线用 `--color-border`，输入框边比发丝线更实。
- 方形色标（2px 圆角）代替圆形点，用于学科身份。
- 不用彩色左边框、玻璃拟态、硬偏移阴影、多顶点 `clip-path`。

## Components

**按钮**：主按钮实心松墨（深色月光青），1px 顶部高光；次按钮纸色描边；危险按钮朱砂。按下缩到 0.97，悬停上浮 1px。

**卡片**：1px 发丝线 + `--shadow-card` + 12px 圆角；卡片内不再套卡片。

**导航**：当前项浅色实心松墨反白（`.ma-nav-current`），深色淡青底 + 青字；移动端淡底，避免整条变重。

**输入**：纸色底、1px `--color-input`、聚焦松墨描边 + 3px 柔光；手机 16px 字号。

**账本行（Ledger）**：标签在左、衬线数字在右、行间 1px 发丝线；用于统计、考试四格、上周摘要。

**图表**：热力图用松墨 4 级透明度；曲线与环形进度取 `--color-primary` / `--color-success` / `--color-mark`。

**导图**：画布是纸（`--color-paper`），节点是抬起的纸片，连接线沿用学科色，选中态松墨。

**舞台**：暖黑底、米白字、琥珀主按钮；标题衬线、数字 `.ma-figure`；结算页用一次“压印”动效。

## Do's and Don'ts

**Do**

- 先改 `foundation.css` 的 token，再改组件；新颜色先登记到本文。
- 用横线与间距分组；让布局解释关系，不靠二级标签。
- 大数字用衬线 + 等宽数字；标题用衬线；操作文字用无衬线。
- 深浅两套、1440 与 390 两个宽度都看一遍。
- 动效只安排一次；其余交互 160–240ms。

**Don't**

- 不用紫色渐变、玻璃、彩色左边框、Emoji 图标、英雄指标模板。
- 不在卡片里再套卡片。
- 不用外部字体 CDN 或系统衬线冒充展示字体。
- 不改信息架构、路由和保存语义来换视觉。
- 不在浅色主题里把沉浸舞台点亮。

**已核对对比度**：浅色正文 15.70:1、次级 4.96:1、主按钮 7.56:1；深色正文 15.96:1、次级 7.06:1、主按钮 8.80:1。
