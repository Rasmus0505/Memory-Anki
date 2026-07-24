# 卡片标记颜色（Card Mark Color）

## 目标

在宫殿编辑右键菜单（含多选）中，于「标记重点」下方提供「标记颜色」：整卡底色标记、调色板自定义、可保存为可重命名/删除的标签；仅编辑模式显示。

## 决策

| 项 | 选择 |
|----|------|
| 视觉 | 整卡底色 |
| 显示范围 | 仅编辑模式（复习/练习不显示） |
| 清除 | 调色板内「清除颜色」 |
| 菜单交互 | 主文案 = 快速套用上次颜色；右侧调色板图标打开飞出面板 |
| 存储 | 方案 A：节点 `data.markColor` + client-preferences `mark_color_labels` |

## 数据

- **节点**：`markColor?: string | null`（CSS 颜色）
- **偏好**：`{ labels: { id, name, color }[], lastUsedColor: string | null }`
- 与复习临时 `fillColor` 分离；投影时仅在无 `revealMap` 时写入 `visual.fillColor`

## 主要改动面

- domain：`setMindMapMarkColors`
- preferences：`shared/preferences/markColorLabels.ts` + 后端 `CLIENT_PREFERENCE_GROUPS`
- UI：`mindMapCanvasActions`、`NodeContextMenu` trailing、`MarkColorFlyout`、`NodeCard` 底色
- editor：`handleMarkColorNodes` 提交文档 + 撤销 toast
