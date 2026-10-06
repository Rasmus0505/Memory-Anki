# E2E 测试封闭性指南（Playwright Hermetic E2E）

> 本文说明为什么 E2E 必须封闭、封闭由哪些机制保证、写新用例时照抄什么、
> 以及越界会被哪个门禁拦下。**违规 E2E 可能写坏本机真实 SQLite 数据，属高危问题。**

## 一句话模型

E2E **绝不接触真实的 8012 服务**：
`fixtures.ts` 把每个 `/api/**` 请求兜底答成 `503`，Service Worker 被屏蔽，
预览服务在 `MEMORY_ANKI_E2E=1` 下移除 `/api` 代理，且严禁复用已在运行的（会代理的）预览实例。

## 为什么必须封闭

本产品是**本地优先、单机单库**：`127.0.0.1:8012` 直接读写当前设备 Syncthing 文件夹里的
`memory_palace.db`。若 E2E 用例把请求打到真实服务，测试就会：

- 往真实数据库插入/修改题目、宫殿、复习记录；
- 触发迁移或后台备份；
- 制造跨设备同步冲突（`memory_palace.sync-conflict-*.db`）。

因此 E2E 的目标不是"连上服务跑通"，而是**在完全无后端的前提下验证前端行为与降级路径**。

## 四道封闭机制

### 1. API 兜底：`apps/web/e2e/fixtures.ts`

```ts
export const test = base.extend<{ hermeticApi: void }>({
  hermeticApi: [
    async ({ page }, use) => {
      await page.route('**/api/**', (route) =>
        route.fulfill({ status: 503, contentType: 'application/json',
                        body: JSON.stringify({ detail: 'e2e: api offline' }) }),
      )
      await use()
    },
    { auto: true },
  ],
})
```

- `auto: true`：**每个**用例自动生效，不需要显式引用。
- 未 mock 的调用得到 `503`，应用走离线/降级路径。
- 用例自带的 `page.route` 叠加在其上，**后注册者优先**，所以单个用例可以精确覆盖自己关心的接口。
- `fixtures.ts` 同时 re-export `expect` 与类型 `Page` / `Route`。

### 2. 强制导入来源

所有 `apps/web/e2e/*.spec.ts` **必须**从 `./fixtures` 导入 `test` / `expect`：

```ts
import { test, expect } from './fixtures'   // ✅
// import { test, expect } from '@playwright/test'  // ❌ 门禁报错
```

直接 import `@playwright/test` 会绕开兜底 fixture，请求将落到真实服务。

### 3. Service Worker 屏蔽

`playwright.config.ts` 中 `use.serviceWorkers: 'block'`。
原因：SW 发起的 fetch 在 WebKit 上**绕过 `page.route`**，会让兜底 503 失效。

### 4. 代理移除与预览隔离

- `vite.config.ts` 的 server 与 preview 两处 `/api` 代理都写成
  `proxy: process.env.MEMORY_ANKI_E2E === '1' ? undefined : {…}`（两处都必须受控）。
- `playwright.config.ts` 的 `webServer`：
  - `env: { MEMORY_ANKI_E2E: '1' }`；
  - `reuseExistingServer: false` —— **绝不复用**可能仍在代理 8012 的游离预览实例；
  - `baseURL: 'http://127.0.0.1:4173'`，即构建产物的本地预览端口。

## 门禁如何强制

`tools/check_architecture.py::check_e2e_hermetic` 在架构检查（因而也在质量门禁）中执行，拦截：

1. 任何 `e2e/*.spec.ts` 中出现 `from '@playwright/test'` / `from "@playwright/test"`；
2. `vite.config.ts` 含 `127.0.0.1:8012` 但 `MEMORY_ANKI_E2E` 出现次数 `< 2`（即只关了一处代理）；
3. `playwright.config.ts` 缺少 `MEMORY_ANKI_E2E` 或缺少 `reuseExistingServer: false`。

对应回归测试：`tools/test_check_architecture.py`（`check_e2e_hermetic` 用例）。

## 写新用例的标准写法

```ts
import { test, expect } from './fixtures'

test('宫殿列表在接口离线时显示降级提示', async ({ page }) => {
  // 1) 只覆盖本用例需要的接口；未覆盖的仍然是 503
  await page.route('**/api/v1/palaces', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

  // 2) 用稳定语义定位（role / label / data-*），不用脆弱的 CSS 层级
  await page.goto('/freestyle')
  await expect(page.getByRole('heading', { name: '随心' })).toBeVisible()
})
```

要点：

- **只 mock 必要接口**，其余保持 503，让降级路径也被覆盖。
- 断言优先用 `role` / 可访问名 / `data-*`；避免依赖易变布局。
- 需要固定时间或随机时，在用例内注入确定性替身，不用真实时间等待。
- 新增 spec 后确认 `python tools/check_architecture.py` 通过。

## 常见越界与后果

| 越界写法 | 后果 |
|---|---|
| `import { test } from '@playwright/test'` | 绕过 503 兜底 → 直连真实库；门禁报错 |
| 关闭 `serviceWorkers: 'block'` | WebKit 上 SW 请求绕过 mock |
| 只处理了 server 代理、漏掉 preview 代理 | 预览服务仍代理 8012；门禁报错 |
| 打开 `reuseExistingServer: true` | 复用可能仍在代理的游离预览，e2e 写入真实数据 |
| 在 spec 里 `page.route('**/api/**')` 全量放行 | 未 mock 接口打到真实服务 |
| 手工起 8012 服务再跑 e2e | 与封闭原则冲突；应使用 4173 预览 |

## 相关配置速查

| 文件 | 关键点 |
|---|---|
| `apps/web/e2e/fixtures.ts` | 兜底 503、`auto: true`、re-export `expect`/类型 |
| `apps/web/playwright.config.ts` | `baseURL: 4173`、`serviceWorkers: 'block'`、`reuseExistingServer: false`、`env.MEMORY_ANKI_E2E=1` |
| `apps/web/vite.config.ts` | server 与 preview 两处 `/api` 代理均由 `MEMORY_ANKI_E2E` 关闭 |
| `tools/check_architecture.py` | `check_e2e_hermetic` 强制以上约束 |
| `tools/test_check_architecture.py` | 门禁自身的回归测试 |

## 验证

- 架构检查：`python tools/check_architecture.py`
- 门禁回归：`python tools/test_check_architecture.py`
- 完整交付（含 Playwright 冒烟）：`python tools/quality_gate.py --full`
- 日常服务运行期间，使用隔离构建避免替换其静态文件：PowerShell `$env:MEMORY_ANKI_VALIDATION_OUT_DIR='dist-validation-trusted-loop'; python tools/quality_gate.py --full`。质量门会把构建写到独立目录，Playwright 预览同一目录；不能指定 `dist`、绝对路径或上级目录。
- 隔离构建不等于发布，不运行 `--launchers`；后者会中断共享服务，应在用户确认维护窗口后执行。
