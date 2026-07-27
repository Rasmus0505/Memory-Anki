# -*- coding: utf-8 -*-
"""Re-run quiz question <-> mindmap node bindings with the AI binder.

Scope: every active palace EXCEPT
  - 外国教育史 第6章 第二~七节  (palace 40,41,42,43,44,45)
  - 英语                        (palace 46)

Per palace:
  1. AI preview (replace_all)
  2. delete ALL existing bindings for the palace (they are all stale
     `auto text-overlap` rows written by the old deterministic binder)
  3. apply the AI edges

Preview runs first, so a failed palace keeps its old bindings untouched.
Resumable: palaces whose edges are already all source='ai' are skipped, so
re-running picks up where the last run stopped. Pass explicit palace ids to
force a subset.

    MEMORY_ANKI_HOME="F:\\memory anki data" python tools/rerun_quiz_node_bindings.py

Writes rerun_report.json next to this script.
"""
from __future__ import annotations

import json
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api" / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from memory_anki.infrastructure.db._tables import get_session  # noqa: E402
from memory_anki.infrastructure.db._tables.palaces import (  # noqa: E402
    Palace,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.quiz.application.ai_dependencies import (  # noqa: E402
    PalaceQuizAiDependencies,
)
from memory_anki.modules.quiz.application.node_binding import (  # noqa: E402
    apply_quiz_node_binding_preview,
    preview_quiz_node_binding,
)
from memory_anki.modules.settings.api import (  # noqa: E402
    SettingsAiRuntimeProvider,
    SettingsPromptCatalog,
)

EXCLUDED_PALACE_IDS = {40, 41, 42, 43, 44, 45, 46}
REPORT = Path(__file__).with_name("rerun_report.json")

session = get_session()
deps = PalaceQuizAiDependencies(
    runtime=SettingsAiRuntimeProvider(session),
    prompts=SettingsPromptCatalog(session),
)

def already_rebound(palace_id: int) -> bool:
    """A palace whose edges are all source='ai' was rebound by a previous run."""
    sources = {
        row.source
        for row in session.query(PalaceQuizQuestionNodeBinding.source)
        .filter(PalaceQuizQuestionNodeBinding.palace_id == palace_id)
        .distinct()
        .all()
    }
    return bool(sources) and sources == {"ai"}


explicit_ids = {int(arg) for arg in sys.argv[1:] if arg.isdigit()}
targets = [
    p
    for p in session.query(Palace)
    .filter(Palace.deleted_at.is_(None))
    .order_by(Palace.id)
    .all()
    if (int(p.id) in explicit_ids)
    or (
        not explicit_ids
        and int(p.id) not in EXCLUDED_PALACE_IDS
        and not already_rebound(int(p.id))
    )
]
print(f"目标宫殿 {len(targets)} 个: {[int(p.id) for p in targets]}\n", flush=True)

report: list[dict] = []
for index, palace in enumerate(targets, 1):
    pid = int(palace.id)
    title = palace.manual_title or palace.title
    before = (
        session.query(PalaceQuizQuestionNodeBinding)
        .filter(PalaceQuizQuestionNodeBinding.palace_id == pid)
        .count()
    )
    entry: dict = {"palace_id": pid, "title": title, "before": before}
    started = time.time()
    print(f"[{index}/{len(targets)}] 宫殿 {pid} 《{title}》 旧绑定 {before} 条 ...", flush=True)
    try:
        preview = preview_quiz_node_binding(
            session,
            ai_dependencies=deps,
            palace_id=pid,
            merge_mode="replace_all",
            batch_size=30,
        )
        entry.update(
            questions=preview["question_count"],
            nodes=preview["mindmap_node_count"],
            proposed=preview["preview_edge_count"],
            unbound=list(preview["unbound_question_ids"]),
            warnings=preview["warnings"][:10],
        )

        # The app's replace_all only clears source='ai'; every existing row here is
        # source='manual' from the old text-overlap script, so clear them explicitly.
        removed = (
            session.query(PalaceQuizQuestionNodeBinding)
            .filter(PalaceQuizQuestionNodeBinding.palace_id == pid)
            .delete(synchronize_session=False)
        )
        session.commit()
        entry["removed_old"] = int(removed or 0)

        applied = apply_quiz_node_binding_preview(
            session,
            palace_id=pid,
            merge_mode="replace_all",
            bindings=preview["bindings"],
            operation_id=preview["operation_id"],
        )
        entry.update(after=applied["item_count"], created=applied["created_count"], ok=True)
        print(
            f"    -> 题 {entry['questions']} / 节点 {entry['nodes']} / "
            f"新绑定 {entry['after']} 条 (旧 {before}) / 未绑定题 {len(entry['unbound'])} "
            f"/ {time.time() - started:.1f}s",
            flush=True,
        )
    except Exception as exc:
        session.rollback()
        entry.update(ok=False, error=f"{type(exc).__name__}: {exc}")
        print(f"    !! 失败: {entry['error']}", flush=True)
        traceback.print_exc()
        report.append(entry)
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        # Account-level gateway failures hit every remaining palace identically;
        # stop instead of burning the rest of the list on the same error.
        if "HTTP 400" in str(exc) or "HTTP 401" in str(exc) or "HTTP 403" in str(exc):
            print(
                "\n!! AI 网关拒绝请求（多半是账号欠费/密钥失效），已中止。"
                "\n   充值或换密钥后重跑本脚本即可从这里继续。",
                flush=True,
            )
            break
        continue
    report.append(entry)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

ok = [e for e in report if e.get("ok")]
print("\n==== 汇总 ====")
print(f"成功 {len(ok)}/{len(report)} 个宫殿")
print(f"旧绑定合计 {sum(e['before'] for e in report)} 条 -> 新绑定合计 {sum(e.get('after', 0) for e in ok)} 条")
print(f"未绑定题合计 {sum(len(e.get('unbound', [])) for e in ok)} 题")
for e in report:
    if not e.get("ok"):
        print(f"  失败: 宫殿 {e['palace_id']} {e['title']} — {e.get('error')}")
session.close()
