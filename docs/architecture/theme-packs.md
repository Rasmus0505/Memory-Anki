# 主题（单一 study 主题包）

应用只剩一套主题「纸墨书房」（`study`）。主题包只描述数据：`ThemePack = { motion, themeColor }`。
不再有多套主题、粒子皮肤、合成音色、环境浮尘或解锁条件；主题不随成长解锁，也没有外观奖励。

```text
shared/theme/packs/study.ts   唯一的主题包 STUDY_PACK
shared/theme/packs/types.ts   ThemePack / ThemeMotion 类型
shared/theme/themePacks.ts    themeMotion()、themeColorFor(scheme)
```

## 内容

| 字段 | 当前值 | 用途 |
|---|---|---|
| `motion.pageTurnMs` | 380 | 随心模式翻页（键盘 / 按钮） |
| `motion.flipMs` | 560 | 思维导图节点翻开 |
| `motion.flipOvershootDeg` | 13 | 翻开落点回弹角度（回弹为其 1/3） |
| `themeColor.light` / `dark` | `#fbf6ef` / `#181411` | 浏览器 `theme-color` |

动效时长在动画开始时读取（`themeMotion()`），因此改动只影响下一次翻页或翻开。

## 规则

- 业务代码不做主题分支，只有一个主题。
- `shared/theme` 不导入 `@/shared/fx`；`shared/fx` 不导入 `@/shared/theme`。
- `check_theme_pack_registry` 检查：每个 pack 文件必须被 `themePacks.ts` 引用；pack 中不得出现 `fxSkin`、`ambient`、`timbre`、`unlock`、`preview` 字段。

## 新增主题

当前不计划新增。若要新增，先更新本文，并让 `check_theme_pack_registry` 覆盖新字段。
