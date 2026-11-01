# 模块：produce

## 状态
活跃 —— 拥有脑图导入任务、AI 拆分、导入 HTTP 路由

## 负责
PDF/文本脑图导入流水线、与 OCR 相邻的任务生命周期、AI 结构拆分

## 公共入口
api.py 和 presentation/import_router.py

## 依赖于
content（文档应用）、platform AI 运行时、pdf_library
