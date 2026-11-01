# 模块：session

## 状态
活跃 —— 拥有进程内实时自习室（在场）。

## 负责
进程内实时自习室（在场、控制器租约、SSE）。

## 迁移自
- sessions

## 禁止
不涉及 FSRS 数学

## 公共接口
- `api.py` / `public/__init__.py` — 实时自习室命令与流

## 跨模块规则
只导入 `memory_anki.modules.session.public`。绝不要导入另一个模块的 application/infrastructure/presentation。
