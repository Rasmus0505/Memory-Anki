# 文章 / 导图工作区验证记录

## 实现范围

同一 canonical editor_doc 的导图/文章视图、稳定节点 UID、共享撤销历史、富文本正文、标题和列表节点创建、层级和章节移动、目录搜索折叠、主动回忆与宿主学习动作、设备本地视图偏好、独立跨设备阅读锚点、Markdown 与完整包的四种导入模式、图片附件、题目与学习组内容的可移植关联、保存冲突保留双方及基线合并。

## 已验证

- 快速质量门禁通过：架构检查、143 个架构测试、数据完整性工具测试、后端 Ruff/Mypy/依赖边界、前端 ESLint/TypeScript。
- 后端完整测试：834 passed（含迁移图和数据保护回归）。
- 前端完整测试：354 files / 2303 passed。
- 新增独立架构回归：5 passed（同时覆盖 article_transfer 与 article_package 文件名）。
- 文章浏览器测试：desktop Chromium、mobile Chromium、mobile WebKit 各 2 项，共 6 项通过；API 全部 mock，未访问真实学习数据库。
- 真实 Tiptap 测试覆盖文本、表格、图片、公式、选区回声、外部撤销、结构快捷键、中文合成保护和图片上传异步 owner 隔离。
- 浏览器测试发现并修复：新增子节点按钮冒泡重选父节点、手机侧栏遮挡、手机导图切换按钮隐藏、文章工具栏页面横向溢出。

## 明确边界

- 跨电脑仍由外部 Syncthing 完成同步，不能同时写共享 SQLite；阅读进度不是协作编辑协议。
- 完整包用于宫殿内容迁移，不等于整库备份；学习历史和调度记录不作为克隆内容携带。
- 无法安全表示的外部图片、跨宫殿题目引用、章节/历史来源关系等会明确报错，不静默丢弃。普通 Markdown 不承诺保留关联身份；可靠更新使用带唯一 UID 锚点的完整包。
- 三方自动合并仅在真实基线和不冲突的节点内容修改时生效；结构冲突与同节点双边修改需要显式选择。
- 富正文中的既有嵌套列表保留为正文；新标题/列表快捷键和显式新增操作创建结构节点。
- 浏览器 IME 测试覆盖事件保护和内容事务，无法替代所有手机系统键盘组合的人工验收。

## 启动与依赖审查

- 原有 Alembic 双 head 使启动器拒绝迁移；新增纯合并 revision 0067，不改现有迁移。由于旧 0050 会删除不兼容题目绑定，运行器新增只读影响检查，有任何关联损失即拒绝执行，禁止 stamp/绕过。当前库只读检查影响数为 0；正常启动前检查会重新计算。迁移前必须停止所有写入者，包括另一台电脑；预检与迁移不是同一个事务。
- `npm audit --omit=dev --audit-level=high` 报告 6 个依赖风险（1 low / 1 moderate / 4 high）：esbuild、nanoid、postcss、react-router / react-router-dom、source-map-js。未执行可能影响共享代码的批量 audit fix；新增 Tiptap/KaTeX/Markdown/ZIP 依赖未在该报告中列出，但这不代表无任何风险。建议另行完成依赖安全升级与回归。

## 最终集成门禁

`python tools/quality_gate.py --full --launchers` 全部 13 个阶段通过（exit 0）。

- 后端 834 项、前端 2303 项均通过，正式构建通过。
- Playwright 全量 47 passed / 4 按平台条件 skipped，2 workers；未放宽断言时间。文章专项 6 项和 iOS PWA 全屏退出在此轮一起通过。
- 带安全预检的正常迁移成功，PWA 服务就绪；Electron 窗口与共享服务启动成功；测试桌面退出后再运行 PWA smoke，复用共享服务正常。
- 启动后只读检查：当前迁移 head 为 0067_merge_quiz_heads，SQLite quick_check 为 ok；跨宫殿/重复绑定影响计数均为 0。foreign_key_check 发现 21 条违规，缺少迁移前基线，不能归因，也不宣称数据库完全无误；未自动修改记录。分类为 pegs→palaces 10 条、study_sessions→palace_mini_palaces 5 条、study_sessions→palace_segments 3 条、study_sessions→palaces 3 条；不在 0050 修改的题目绑定表中，仍需单独带备份审计。
- 独立文章架构回归 5 passed；已有 React act / SQLite datetime deprecation / 大 bundle 警告仍存在，不作为本次无警告承诺。

