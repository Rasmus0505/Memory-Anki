# 题库语义去重流水线

对 `palace_quiz_questions` 做「大模型判语义」的重复题清理。只软删（写 `deleted_at` / `updated_at`，与 API 的 `commit_deleted_questions` 一致），写库前整库备份，并输出回滚清单。

## 用法

准备一个工作目录（脚本的中间产物都落在那里）：

```bash
mkdir -p tmp/dedup-$(date +%Y%m%d)
cp tools/question-dedup/*.py tools/question-dedup/JUDGE_BRIEF.md tmp/dedup-$(date +%Y%m%d)/
cd tmp/dedup-$(date +%Y%m%d)
export DEDUP_WORK="$PWD"                       # 中间产物目录
export MEMORY_ANKI_DB="C:/MemoryAnki/memory anki data/学习数据/memory_palace.db"
```

1. **导出 + 聚簇**

```bash
python export_questions.py
python build_clusters.py          # 相似度阈值在文件顶部 SIM
python classify.py                # 机械重复直接定案；其余生成 llm_batches/
```

2. **让大模型判 `llm_batches/` 里的簇**

把 `JUDGE_BRIEF.md` 交给判定方（子代理或任何大模型），要求每批输出一个 JSON 数组到 `verdicts/`：

```json
[{"g": "b00-00", "dup": true, "keep": 4964, "drop": [4965], "why": "同题干同答案，保留有选项的", "conflict": false}]
```

- `dup=false` 表示不是重复。
- 答案互相矛盾时 `dup=true, conflict=true, drop=[]`，只挂起不删。
- 只删 `drop` 里列出的 id，**不要用 `ids - keep` 推导**：一个簇里可能混着两道不同的题。

3. **校验**

```bash
python validate_verdicts.py llm_batches verdicts
```

4. **出计划（干跑）**

```bash
python apply_plan.py              # 打印将删多少、按学科分布、校验问题
python apply_plan.py --apply      # 备份 + 软删 + 回滚清单
```

`apply_plan.py` 会：并查集合并「A 组留 X、B 组删 X」这类链；每个宫殿至少保留一条（跨宫殿同题不合并）；删前复核目标行仍在世。

5. **第二轮补漏（可选）**

```bash
python build_batches2.py          # 同宫殿 0.55–0.70 的漏网对
# 判定写入 verdicts2/，再跑 validate_verdicts.py llm_batches2 verdicts2
python apply_plan.py --apply
```

6. **收尾补漏**

```bash
python residual_fix.py            # 干跑
python residual_fix.py --apply    # 同宫「简答答案 = 选择题选项」的双胞胎
```

7. **答案冲突与坏答案**

```bash
python fix_conflicts.py            # 干跑：同题两套答案的逐组结论
python fix_single_choice.py        # 干跑：源标签写单选、却存了多个答案的题
```

两个脚本都是显式清单（先人工核对再写进脚本），`--apply` 会先备份整库。

8. **清理 OCR 分页脏字**

```bash
python clean_ocr_tails.py            # 干跑，逐条打印 before/after
python clean_ocr_tails.py --apply    # 备份后写入
```

只做四类高置信度截断：选项末尾页码、「页码 科目，题型」标签、「页码,下一题开头」、以及显式清单里的个别选项。题干不做通用截断（材料题里本来就有「材料 1，」这种写法）。

## 判定口径（摘要）

算重复：题干归一化后相同且答案一致；选择题与简答题两版（简答答案即正确选项）；跨来源同题（凯程/冬青/丹丹、腿姐刷题计划与拆真题、腿姐与肖 1000）。

不算重复：同知识点换问法、同材料不同问题、选项不同导致答案不同、只改数字人名的变式题。

保留优先级：有作答记录 > 有选项 > 有解析 > 导入更早。

## 注意

- 脚本默认连真实库，`--apply` 前先跑干跑；`apply_plan.py` 自带备份和校验，校验不过会拒绝写入。
- 回滚：`update palace_quiz_questions set deleted_at = null where id in (...)`，id 见 `rollback-*.json`。
- 2026-11-06 首次执行：7222 → 5738，删 1484，另修 2 道答案、13 道单选多答案。详见 `deliverables/题库去重-2026-11-06.md`。
