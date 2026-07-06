# 页面状态丢失与宫殿编辑页打不开 Bug 执行清单

> 基于部分代码调研撰写，可直接对照文件开工。范围：修复"书架→宫殿详情→切走→切回变书架"的状态丢失、排查并修复"宫殿编辑页打不开"的阻断性问题。

---

## 根因分析

### 问题1："切走再切回变书架"的根因

已定位到核心机制：

1. **路由驻留缓存**（`apps/web/src/app/router/AppRouter.tsx`）：按 `pathname` 作为缓存键，用 `display:none` 保留组件状态，LRU 上限 4 条（`MAX_RESIDENT_ROUTE_COUNT = 4`）。**注意：驻留缓存是按完整 pathname 缓存，即 `/palaces` 和 `/palaces/123` 是两个独立的缓存槽位**，这个机制本身是正确的。

2. **导航目标记忆机制**（`apps/web/src/app/shell/AppShell.tsx`）：侧边栏各导航项有 `rememberLastVisited` 标志位，为 `true` 的项（如 palaces）会把用户最后访问的完整路径（含参数）记录在 `navSectionLastUrls` 对象里（第 68 行，这是一个**模块级全局变量**），点击导航项时通过 `getNavSectionTargetUrl` 读取记忆的 URL 而非默认的 `/palaces`。

3. **问题的断点**：`navSectionLastUrls` 是纯内存变量，页面刷新或应用重启后会丢失；更重要的是，**这个变量的更新逻辑在 `AppShell.tsx` 第 313-315 行**，依赖 `useEffect` 监听 `pathname/search/hash` 变化来写入。如果这个 `useEffect` 因为某种原因没有正确触发（比如组件卸载时序、或者从书架进入宫殿详情时 `matchedSection` 判断逻辑有问题），就会导致记忆失败，下次点击侧边栏"记忆宫殿"时仍然导航到默认的 `/palaces`（书架），而驻留缓存里虽然保留了 `/palaces/123` 的组件实例，但根本没被激活显示。

### 问题2："宫殿编辑页打不开"的可能原因

目前掌握信息有限，需要进一步排查的方向：

1. 懒加载失败：宫殿编辑页可能是动态 import，加载失败时没有被 ErrorBoundary 正确捕获，导致白屏或路由卡住。
2. 思维导图 iframe host 时序问题：已知脑图编辑器用 iframe 承载且关闭了 HMR（`apps/web/vite.config.ts` 里 `server.hmr: false`），可能存在 iframe 加载未完成时父组件已尝试与其通信导致挂起。
3. 权限或状态拦截：编辑页路由上是否有某种守卫逻辑（如"只有宫殿 owner 可编辑"）误拦截了合法访问。

---

## 任务 1：修复"记忆上次访问路径"的更新时机问题

**现状 -> 目标对照**
- 现状：`navSectionLastUrls` 的更新依赖 `AppShell.tsx` 内的 `useEffect`（第 313-315 行），但从实测来看这个更新在某些路径切换场景下没有正确触发，导致从书架进入宫殿详情后、再次点击侧边栏"记忆宫殿"时，读到的仍然是旧的或默认的 `/palaces`。
- 目标：确保每次进入带参数的宫殿路径（如 `/palaces/123`、`/palaces/123/edit`）时，`navSectionLastUrls['palaces']` 都能被正确更新为当前完整路径（含 search 和 hash）。

**具体改动**
- 文件：`apps/web/src/app/shell/AppShell.tsx`
- 第 313-315 行的 `useEffect` 依赖项是 `[hash, pathname, search]`，这本身是对的，但需要检查：
  1. `matchedSection` 的计算逻辑（第 177-178 行 `findNavSection`）是否在所有情况下都能正确匹配到 `palaces` section——比如 `/palaces/123/edit` 是否被正则 `/^\/palaces\/\d+(?:\/(edit|practice|focus-practice|quiz))?$/` 正确匹配（第 104 行）。
  2. 这个 `useEffect` 的位置是否在正确的生命周期里执行——如果 `AppShell` 组件在路由切换时被重新挂载（虽然不太可能，因为它是根组件），或者 `location` 对象引用变化导致 effect 没触发，都会导致记忆失败。
- **调试步骤**：在 `useEffect` 内部加 `console.log`，走一遍"书架→宫殿详情→切走→点击侧边栏记忆宫殿"的完整流程，看每次路径变化时这个 effect 是否都触发、`matchedSection` 是什么、`navSectionLastUrls` 最终记录了什么值。
- **可能的修复方向**：如果发现 effect 触发了但 `matchedSection` 为 null（说明正则没匹配上），需要修正第 104 行的正则；如果发现 effect 根本没触发，可能需要把依赖项改为 `[location]`（整个 location 对象）而非单独的 `pathname/search/hash` 三个字段。

**验收标准**
- 从书架（`/palaces`）点击某个宫殿卡片进入详情（`/palaces/123`），然后点击侧边栏其他导航项（如"仪表盘"），再点击侧边栏"记忆宫殿"，应该直接回到 `/palaces/123` 而不是书架列表。
- 同样的流程适用于宫殿编辑页（`/palaces/123/edit`）、宫殿练习页（`/palaces/123/practice`）等所有 palaces section 匹配的子路由。
- 添加一条针对这个具体场景的端到端测试（参考 `apps/web/src/app/shell/AppShell.test.tsx`），防止再次回退。

---

## 任务 2：持久化"记忆上次访问路径"到 localStorage（可选，视任务1效果而定）

**现状 -> 目标对照**
- 现状：`navSectionLastUrls` 是纯内存变量，页面刷新或应用重启后会丢失。
- 目标：如果任务1修复后发现"只要不刷新页面，记忆就正常"，说明更新逻辑本身已经修好，但用户仍然会因为刷新页面而丢失记忆；可以进一步把 `navSectionLastUrls` 持久化到 localStorage（类似现有很多偏好设置的做法），让记忆在刷新后依然生效。

**具体改动**
- 文件：`apps/web/src/app/shell/AppShell.tsx`
- 在 `navSectionLastUrls` 对象的读写位置加一层 localStorage 序列化/反序列化逻辑：
  - 初始化时从 `localStorage.getItem('memory-anki.nav-section-last-urls')` 读取并 parse。
  - 每次更新 `navSectionLastUrls[key]` 后立即 `localStorage.setItem` 保存最新状态。
- 注意：这一步是可选的，优先级低于任务1；如果用户实际使用中很少刷新页面，这个持久化的收益可能不高，可以先做任务1、观察效果再决定要不要做任务2。

**验收标准**
- 进入宫殿详情后刷新页面，再点击侧边栏"记忆宫殿"，仍然能回到刷新前的宫殿详情而不是书架。

---

## 任务 3：排查并修复"宫殿编辑页打不开"的根因

**具体调试步骤**（按优先级从高到低排查）

### 步骤 3.1：检查懒加载与 ErrorBoundary
- 文件：`apps/web/src/app/router/appRoutes.tsx`（或类似命名）
- 找到 `/palaces/:id/edit` 对应的路由配置，确认是否用了 `React.lazy` 动态导入。
- 如果是懒加载，检查 ErrorBoundary 是否覆盖了这个路由（可能在 `AppRouter.tsx` 或 `appRoutes.tsx` 的某个父层级）。
- **复现测试**：打开浏览器控制台的 Network 面板，尝试进入宫殿编辑页，看是否有某个 chunk 文件加载失败（404 或 timeout），或者 Console 里有未捕获的异常。

### 步骤 3.2：检查思维导图 iframe host 的加载时序
- 文件：`apps/web/src/shared/components/mindmap-host/`（具体文件名可能是 `MindMapHost.tsx` 或 `MindMapFrame.tsx`）
- 宫殿编辑页应该会渲染这个 iframe host 组件，检查 iframe 的 `src` 加载逻辑、父子通信的初始化握手（postMessage/onMessage）是否有超时或错误处理。
- **复现测试**：如果编辑页能部分加载但卡在白屏或 loading，用 Chrome DevTools 的 "Inspect iframe" 看 iframe 内部是否有错误；或者在主窗口 Console 里看是否有 postMessage 通信超时的日志。

### 步骤 3.3：检查路由守卫或权限拦截
- 搜索 `apps/web/src/app/router/appRoutes.tsx` 或相关文件，看 `/palaces/:id/edit` 路由配置里是否有 `loader` 或前置 hook 做权限检查（比如"当前用户是否是这个宫殿的 owner"）。
- 如果有，检查这个权限逻辑是否误拦截了正常访问（比如后端 API 返回 403、但前端没有友好提示就卡住）。

### 步骤 3.4：检查 HMR 关闭是否引入副作用
- 文件：`apps/web/vite.config.ts`
- 已知 `server.hmr: false` 是为了脑图编辑器稳定性而关闭的，但这可能导致开发模式下某些模块热更新失败后无法自动恢复，需要手动刷新。
- **测试方法**：在生产构建（`npm run build` 后用 `npm run preview` 或直接部署）下复现"宫殿编辑页打不开"的问题——如果生产模式下正常、只有 dev 模式下出问题，说明是 HMR 关闭的副作用，可以暂时忽略（开发时手动刷新规避）或者给脑图编辑器独立一个 dev server（这是架构层清单里提到的长期方向）。

**验收标准**
- 能稳定复现"宫殿编辑页打不开"的具体触发路径（比如"从书架点击编辑按钮→白屏"或"从宫殿详情点击编辑→卡住"），并定位到具体的错误堆栈或加载失败的资源。
- 根据定位结果应用对应修复（比如加 ErrorBoundary、修 iframe 加载逻辑、修权限判断），修复后同样的触发路径能正常进入编辑页并显示脑图编辑器。
- 添加一条回归测试覆盖"进入编辑页不报错、能看到编辑器界面"这个最基础的冒烟检查。

---

## 任务 4：端到端回归测试补充

**具体改动**
- 文件：新建或扩展 `apps/web/src/app/router/AppRouter.test.tsx`（或相近命名）
- 补充以下两条关键场景的端到端测试（可以是集成测试或 E2E 测试）：
  1. **驻留缓存场景**：模拟"导航到 `/palaces/123` → 导航到 `/dashboard` → 导航回 `/palaces/123`"，断言第二次导航后看到的仍然是同一个宫殿详情实例（通过某个组件内部状态或 DOM 元素判断）。
  2. **记忆导航场景**：模拟"导航到 `/palaces/123` → 点击侧边栏其他项 → 点击侧边栏'记忆宫殿'"，断言最终停留在 `/palaces/123` 而不是 `/palaces`。
  3. **编辑页加载场景**：模拟"导航到 `/palaces/123/edit`"，断言页面加载完成、没有未捕获异常、能看到编辑器相关 DOM 元素。

**验收标准**
- 三条测试都能通过，且在 CI（GitHub Actions）里稳定不 flaky。

---

## 建议开工顺序

1. 任务 1（修复记忆更新逻辑，这是问题1的核心，优先级最高）
2. 任务 3（排查编辑页打不开的根因，阻断性 bug，第二优先）
3. 任务 4（补充回归测试，防止再次退化）
4. 任务 2（持久化记忆到 localStorage，可选，视实际使用频率决定要不要做）

## 关键文件清单
- `apps/web/src/app/router/AppRouter.tsx`（驻留缓存核心）
- `apps/web/src/app/shell/AppShell.tsx`（导航目标记忆逻辑）
- `apps/web/src/app/router/appRoutes.tsx`（路由配置、懒加载、守卫）
- `apps/web/src/shared/components/mindmap-host/`（脑图编辑器 iframe host）
- `apps/web/vite.config.ts`（HMR 关闭配置）
- `apps/web/src/app/shell/AppShell.test.tsx`（导航相关测试基线）
