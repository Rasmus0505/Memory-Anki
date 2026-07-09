# 1000 题库一次性数据管线（已归档）

这批脚本是 2025 年把《考研政治 1000 题》纸质题库导入 Memory Anki 的一次性管线，
数据已导入完成，日常运行不需要它们。归档保留仅为追溯与将来导入类似题库时参考。

## 管线顺序

1. locate_1000_quiz_pages.py    —— 在源 PDF 中定位题目页码
2. render_1000_question_pages.py —— 渲染题目页为图片
3. ocr_1000_questions.py        —— 对题目页做 OCR
4. merge_1000_page_drafts.py    —— 合并分页草稿
5. build_1000_questions_manifest.py —— 生成题目清单 manifest
6. audit_1000_quiz_bank.py      —— 审计导入后的题库质量
7. repair_1000_quiz_bank_local.py —— 本地修复题库（含批准的补充题数据）
8. backfill_1000_quiz_ocr_sources.py —— 回填 OCR 来源（依赖同目录 repair 脚本）
9. build_1000_quiz_rerun_plan.py / run_1000_quiz_rerun_plan.py —— 构建并执行重跑计划
10. save_1000_quiz_preview_results.py —— 保存预览结果

## 注意

- 脚本内写死了当时的个人绝对路径（如 D:\考研（丹丹）\1000题、D:\BaiduSyncdisk\...），
  换设备/换数据源需自行修改；这些路径已在 tools/check_architecture.py 的
  BASELINE_PERSONAL_PATH_TOOLS 中豁免。
- backfill_1000_quiz_ocr_sources.py 从同目录 import repair_1000_quiz_bank_local，
  两个文件必须放在一起。
- 直接操作 SQLite 数据库文件，运行前务必先备份 memory_palace.db。
