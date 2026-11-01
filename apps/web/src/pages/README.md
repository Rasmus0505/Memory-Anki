# 页面

Memory Anki 的路由级组合。页面可以组合 widgets 和运行时模块（通过各模块的 `public.ts`），但不得拥有可复用的领域逻辑，也不得直接调用后端端点。

`create/PalaceEditorPage` 拥有跨宫殿编辑、脑图编辑器/导入/体验以及测验启动器能力的路由级组合。由编辑器支撑的知识大纲和宫殿版本预览 UI 位于页面旁边；可复用的宫殿编辑状态和业务面板保留在 `modules/content`（palace-edit UI）中，后者对其他模块的内部实现没有生产依赖。学习组选择与跨功能画布组合仍归页面所有。

`library/PalaceListPage` 和 `library/PalaceLibraryPage` 拥有复习书架组合；`modules/content`（palace-catalog UI）拥有目录行为，而不导入 practice 内部实现。复习书架复习在 `/palaces/<id>/review` 打开 `library/PalaceReviewPage`，其复用随心信息流。独立的 `/review` 页面未注册。

`settings/SettingsOverviewPage` 通过显式的组件端口，将个人资料设置与复习维护命令和快捷键 UI 组合在一起；`modules/settings`（profile UI）仍独立于这些模块。

`library/KnowledgeLibraryPage` 拥有跨脑图编辑器、体验模式、导入工作流和可复用知识对话框的知识路由组合。
