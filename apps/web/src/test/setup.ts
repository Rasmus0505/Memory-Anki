/**
 * Vitest 全局测试 setup。
 *
 * 仅设置 act 环境标志以消除 act 相关警告。
 *
 * 注意：本项目 React 19 + @testing-library/react 存在已知的 act 兼容问题
 * （react 入口不再导出 act，而 testing-library 的 act-compat 在加载时
 * 取 react-dom/test-utils 的 act，后者内部又调 React.act）。这导致使用
 * `render`/`renderHook` 的测试无法运行——这是预先存在的环境问题，与本
 * 次改动无关。需要 React 渲染的测试用例待 testing-library 适配 React 19
 * 后恢复；不依赖 React 渲染的纯函数/集成测试照常工作。
 */
import { configure } from '@testing-library/react'
import { beforeEach } from 'vitest'
import { resetQuizOptionAutoShufflePendingForTest } from '@/modules/quiz/domain/quiz-entity/model/quizOptionShuffle'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The full suite shares a synced disk and runs many workers; a screen update
// that takes ~100ms alone can cross the 1s findBy/waitFor default there. Keep
// the per-test budget (15s) as the real failure boundary instead. A genuine
// never-rendered element still fails, just later.
configure({ asyncUtilTimeout: 3000 })

// 自动打乱只在“下一次见到这道题”时生效，所以它会按题目 id 跨组件挂载保留。
// 测试之间共享同一份 sessionStorage，必须在每个用例前清空，否则前一个用例的
// 快速作答会把后一个用例的选项顺序换掉。
beforeEach(() => {
  resetQuizOptionAutoShufflePendingForTest()
})

// jsdom 没有 ResizeObserver；radix 的 Slider/useSize 等组件在挂载时需要它。
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
}
