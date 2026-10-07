# `tools/check_architecture.py`：拆分不是正确的修复方向（C1b 调查结论）

> 审计建议拆分这个 5829 行的架构检查脚本。实测后结论：**拆分的收益不存在，风险却是实的**；
> 该文件真正的问题不是长度。本文记录证据，避免后人重复评估同一个方向。

## 1. 拆分的收益不存在：`tools/` 不受任何行数门禁约束

仓库的行数门禁只作用于 `apps/web/src`（750）与 `apps/api/src`（800）：

```python
for path in iter_files(WEB_SRC, (".ts", ".tsx")):   # 750
for path in iter_files(API_SRC, (".py",)):          # 800
```

`tools/` 不在其中，所以 `check_architecture.py` 的 5829 行本身不违反任何规则。
把它拆到 5500 行既不会让门禁变绿（它本来就是绿的），也不改变任何行为。

## 2. 拆分的风险是实的：会静默打断 263 处 monkeypatch

`tools/test_check_architecture.py` 用路径加载该模块，**且不注册 `sys.modules`**（已实测）：

```python
spec = importlib.util.spec_from_file_location("check_architecture", CHECK_ARCHITECTURE_PATH)
check_architecture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_architecture)
# -> "check_architecture" in sys.modules  ==  False
```

而该测试有 **263 处** `monkeypatch.setattr(check_architecture, "WEB_SRC"/"API_SRC"/"REPO_ROOT"/..., tmp_path)`
把路径指向临时 fixture 树，另有 140 处直接调用 `check_architecture.check_*`。

若把 18 个 `check_freestyle_*`（1744 行）移入子模块，子模块在执行 `import check_architecture`
时会**重新执行**父文件、得到第二个模块实例，其全局与测试 patch 的实例互不相通。
后果不是报错，而是**测试静默改为读取真实仓库文件**：`accept` 用例仍会通过，`reject` 用例
因 fixture 未被读取而失败——也就是"守卫看起来还在，实际已经失效"，与本次已修的
`BASELINE_OVERSIZED_FILES` 陈旧条目属同一缺陷类别。

已验证的可行替代是让子模块在**调用时**惰性读取父模块全局，但这要求父文件先把自己
注册进 `sys.modules`（`exec_module` 之前该键不存在，`setdefault(__name__, sys.modules[__name__])`
会抛 `KeyError`）。要安全落地需要同时改造测试的加载方式，属于独立工程。

## 3. 真正的问题不是长度，而是断言方式

拆成三个文件后，这 5829 行仍然是同样性质的断言：

| 指标 | 数量 |
|---|---|
| `not in <...>source` 式**源码文本**断言 | 264 |
| `must not <...>` 散文措辞断言 | 109 |
| 读取 `docs/*.md` 并匹配措辞 | 36 |
| `read_text()` 读取源码的次数 | 302 |

典型形态（`check_freestyle_retry_starts_unrated`）：

```python
if "must not prefill the retry rating" not in source:      # 断言源码里的注释
    errors.append("a parent 忘记/困难 must not prefill the retry rating.")
if "starts with a blank rating" not in feed_source:        # 断言文档里的措辞
```

这类检查把"意图"编码成了脆弱字符串匹配：改一句注释就会让门禁变红，而真实行为回归
却不会被发现。**正确的修复是把它们改写成行为测试**（Vitest 驱动真实组件），
那是独立的大工程，收益与风险都远高于本次其他项，不应作为"拆分"顺带完成。

## 4. 本次对该文件已做的真实修复

- `fad09962`：27 条超限白名单中已有 **8 条失效**（1 个文件删除、7 个已达标），
  而 `check_file_sizes` 会整条跳过白名单路径，等于这些路径的门禁形同虚设。
  已清理并新增 `check_oversized_baseline_is_current`，使白名单只能收紧、不能腐烂。
- 已验证 retirement guard 工作正常：把 `mini_palace_nodes.py` 重新创建后，
  检查确实报出 "mini palace is retired"，并非静默跳过。
