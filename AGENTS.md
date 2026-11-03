# Memory Anki 代理规则

- 结构性改动之前先阅读 `AI_PROJECT_CONTEXT.md`，并使用 `docs/architecture/README.md`（门禁资产最小集）与各模块 `MODULE.md` 作为当前的依赖关系图；文档总索引见 `docs/README.md`。
- 把现有的工作树视为共享工作：先检查 `git status`，绝不回退无关改动，并保持文件归属明确。
- 这是一个私有的双设备 Windows 产品。绝不要硬编码某台机器的路径。运行时数据按机器配置在 `local-config/memory-anki.local.json`（`local_app_home`）中，并指向该机器同步的数据文件夹（例如 `F:\memory anki data`；不要假设盘符）。跨设备同步发生在应用之外；应用没有文件同步实现或同步配置。同一时间只有一台设备写入数据。不要使用百度的 `MemoryAnki-Sync`。回退方案：`MEMORY_ANKI_HOME` / `%LOCALAPPDATA%\MemoryAnki`。
- PWA 和桌面端使用相同的前端和本地后端。不要创建单独的移动应用、公开的 SaaS 后端或云端数据依赖。
- 保持依赖方向：表现/UI 层组合用例；领域/文档代码保持不依赖框架；跨模块调用使用公共门面、端口或事件。
- 新的异步实体作用域工作必须携带稳定的 owner/operation 身份，使过期请求无法更新另一个实体。
- 反馈统一通过来自 `@/shared/fx` 的 `cue()`；只允许声音、触觉和 CSS 果冻动画（`styles/motion.css`）。不允许粒子或 canvas 特效，也不允许在音频通道之外调用 WebGL 或 WebAudio。尊重 `prefers-reduced-motion`。延迟步骤必须调度在 cue 的 `FxPlayback` owner 上，以便退役某个 owner 时取消它们。实现入口：`apps/web/src/shared/fx` 与 `apps/web/src/shared/feedback/mindmap-audio`（旧 `docs/architecture/fx-director.md`、`audio-soundscape.md` 已于 2026-11-04 删除）。
- Playwright E2E 是封闭隔离的。`apps/web/e2e/` 下的规范必须从 `./fixtures` 导入 `test`/`expect`，绝不能从 `@playwright/test` 导入；绝不要在 `MEMORY_ANKI_E2E=1` 下重新启用 `/api` 代理，绝不允许 `reuseExistingServer`，也绝不要让规范指向正在运行的 `8012` 服务。`check_e2e_hermetic` 会强制执行此规则，而违规可能写入真实的同步数据库。入口见 `apps/web/e2e/fixtures.ts`。
- 迭代过程中运行 `python tools/quality_gate.py`，交接前在环境支持完整套件时运行 `python tools/quality_gate.py --full`。
- 在可能影响运行时启动、打包、迁移、依赖、前端构建产物或启动脚本的改动之后，运行 `python tools/quality_gate.py --launchers`。这是破坏性的 Windows 冒烟测试：它真的会运行 `start-all.bat --smoke-test` 和 `start-all.bat --desktop`，验证 API 和 Electron 启动，清理测试桌面进程，并恢复共享的 PWA 服务。
- 如果架构发生变化，更新 `AI_PROJECT_CONTEXT.md` 或对应模块的 `MODULE.md`；只有门禁直接消费的 10 份文档才放进 `docs/architecture/`，并在 `tools/check_architecture.py` 中扩展一个聚焦的回归测试。
