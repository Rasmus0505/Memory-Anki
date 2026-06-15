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
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
