# 01-添加移动端CSS样式 ✅ 已完成

## 目标
在 `apps/web/src/index.css` 文件末尾添加移动端 PWA 专属样式。

## 文件位置
`apps/web/src/index.css`

## 执行步骤

### 步骤1：读取现有文件
使用 Read 工具读取 `apps/web/src/index.css` 文件，确认末尾内容（文件总共约1719行）。

### 步骤2：在文件末尾追加以下内容

使用 Edit 工具，在文件最后一行（`.memory-anki-surface-glow::before` 规则的闭合大括号后）追加：

```css
/* ======================================
   移动端 PWA 专属样式
   ====================================== */

/* CSS 变量：safe area insets（iOS 刘海/Home 指示条） */
:root {
  --mobile-safe-area-inset-top: env(safe-area-inset-top, 0px);
  --mobile-safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
  --mobile-safe-area-inset-left: env(safe-area-inset-left, 0px);
  --mobile-safe-area-inset-right: env(safe-area-inset-right, 0px);
  
  /* Tab Bar 高度（底部导航栏） */
  --mobile-tab-bar-height: 64px;
  
  /* 触控目标最小尺寸 */
  --mobile-touch-target-min: 44px;
}

/* 移动端 PWA 全局样式 */
.memory-anki-mobile-pwa,
.memory-anki-mobile-pwa body {
  /* 禁用下拉刷新 */
  overscroll-behavior-y: contain;
  
  /* 禁用文本选择（游戏化交互） */
  -webkit-user-select: none;
  user-select: none;
  
  /* 禁用长按菜单 */
  -webkit-touch-callout: none;
  
  /* 优化触控滚动 */
  -webkit-overflow-scrolling: touch;
  
  /* iOS 点击高亮透明 */
  -webkit-tap-highlight-color: transparent;
}

/* 输入框和文本区域例外：允许文本选择 */
.memory-anki-mobile-pwa input,
.memory-anki-mobile-pwa textarea,
.memory-anki-mobile-pwa [contenteditable] {
  -webkit-user-select: text;
  user-select: text;
}

/* 移动端根容器 */
.memory-anki-mobile-pwa #root {
  min-height: 100vh;
  min-height: 100dvh; /* 动态视口高度 */
  display: flex;
  flex-direction: column;
  
  /* 应用 safe area */
  padding-top: var(--mobile-safe-area-inset-top);
  padding-bottom: var(--mobile-safe-area-inset-bottom);
  padding-left: var(--mobile-safe-area-inset-left);
  padding-right: var(--mobile-safe-area-inset-right);
}

/* 移动端页面容器 */
.mobile-page-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-background);
}

/* 移动端内容区域（滚动区域） */
.mobile-content-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  
  /* 为底部 Tab Bar 留出空间 */
  padding-bottom: calc(var(--mobile-tab-bar-height) + 1rem);
}

/* 底部 Tab Bar 容器 */
.mobile-tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--mobile-tab-bar-height);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--color-border);
  
  /* 应用底部 safe area */
  padding-bottom: var(--mobile-safe-area-inset-bottom);
  
  /* 确保在最上层 */
  z-index: 1000;
  
  /* iOS 毛玻璃效果 */
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
}

/* Tab Bar 内部布局 */
.mobile-tab-bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 0 8px;
}

/* Tab 按钮 */
.mobile-tab-button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: var(--mobile-touch-target-min);
  min-height: var(--mobile-touch-target-min);
  padding: 4px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-muted-foreground);
  -webkit-tap-highlight-color: transparent;
}

.mobile-tab-button:active {
  transform: scale(0.95);
}

.mobile-tab-button.active {
  color: var(--color-primary);
}

.mobile-tab-button svg {
  width: 24px;
  height: 24px;
}

.mobile-tab-button span {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

/* 移动端顶部标题栏 */
.mobile-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 16px;
  background: var(--color-card);
  border-bottom: 1px solid var(--color-border);
  
  /* 应用顶部 safe area */
  padding-top: max(12px, var(--mobile-safe-area-inset-top));
}

.mobile-top-bar h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-foreground);
  margin: 0;
}

/* 触控友好的按钮 */
.mobile-touch-button {
  min-width: var(--mobile-touch-target-min);
  min-height: var(--mobile-touch-target-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  font-size: 16px;
  font-weight: 500;
  border-radius: 12px;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.mobile-touch-button:active {
  transform: scale(0.96);
}

/* 移动端卡片 */
.mobile-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 20px;
  margin: 12px 16px;
  box-shadow: var(--shadow-card);
  transition: all 0.2s ease;
}

.mobile-card:active {
  transform: scale(0.98);
}

/* 移动端列表项 */
.mobile-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  min-height: 64px;
  background: var(--color-card);
  border-bottom: 1px solid var(--color-border);
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.mobile-list-item:active {
  background: var(--color-accent);
}

/* 移动端间距工具类 */
.mobile-px {
  padding-left: 16px;
  padding-right: 16px;
}

.mobile-py {
  padding-top: 16px;
  padding-bottom: 16px;
}

.mobile-gap {
  gap: 16px;
}

/* 移动端排版优化 */
.memory-anki-mobile-pwa {
  /* 更大的基础字号 */
  font-size: 16px;
  line-height: 1.5;
}

.memory-anki-mobile-pwa h1 {
  font-size: 24px;
  line-height: 1.3;
}

.memory-anki-mobile-pwa h2 {
  font-size: 20px;
  line-height: 1.4;
}

.memory-anki-mobile-pwa h3 {
  font-size: 18px;
  line-height: 1.4;
}

/* 移动端全屏加载状态 */
.mobile-loading-screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--color-background);
  z-index: 9999;
}

/* 移动端空状态 */
.mobile-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
  color: var(--color-muted-foreground);
}

.mobile-empty-state svg {
  width: 64px;
  height: 64px;
  opacity: 0.3;
}

/* 移动端滚动阴影提示 */
.mobile-scroll-shadow-top {
  box-shadow: inset 0 8px 8px -8px rgba(0, 0, 0, 0.1);
}

.mobile-scroll-shadow-bottom {
  box-shadow: inset 0 -8px 8px -8px rgba(0, 0, 0, 0.1);
}

/* 深色模式适配（如果需要） */
@media (prefers-color-scheme: dark) {
  .mobile-tab-bar {
    background: rgba(24, 24, 27, 0.92);
    border-top-color: rgba(255, 255, 255, 0.1);
  }
}

/* 横屏适配（移动端横屏时优化布局） */
@media (orientation: landscape) and (max-height: 500px) {
  .mobile-top-bar {
    height: 48px;
  }
  
  .mobile-tab-bar {
    --mobile-tab-bar-height: 56px;
  }
  
  .mobile-tab-button {
    min-height: 40px;
  }
  
  .mobile-tab-button span {
    display: none; /* 横屏时隐藏文字，只显示图标 */
  }
}
```

### 步骤3：验证
使用 Read 工具读取文件末尾部分，确认样式已正确添加。

## 验证标准
- ✅ CSS 语法正确，无语法错误
- ✅ CSS 变量定义在 `:root` 中
- ✅ 移动端专属样式都以 `.memory-anki-mobile-pwa` 或 `.mobile-` 开头
- ✅ Safe area insets 正确使用 `env(safe-area-inset-*)`
- ✅ Tab Bar 样式完整定义

## 预期效果
- 移动端 PWA 页面会自动应用 safe area insets
- 底部 Tab Bar 会正确显示在安全区域内
- 所有触控目标满足 44px 最小尺寸
- iOS 设备上的刘海和 Home 指示条区域会被正确处理

## 下一步
完成后，继续执行 `02-创建移动端布局组件.md`
