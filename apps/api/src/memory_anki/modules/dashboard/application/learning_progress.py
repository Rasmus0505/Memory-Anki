"""Read-only coverage of real document leaves with distinct identity rollups."""
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from memory_anki.modules.content.public.queries import read_learning_progress_catalog
from memory_anki.modules.memory.public.queries import read_learning_progress_evidence
from memory_anki.modules.quiz.public.queries import read_learning_progress_quiz


class LearningProgressMetrics(BaseModel):
    memory_total: int = Field(ge=0)
    memory_reviewed: int = Field(ge=0)
    memory_due: int = Field(ge=0)
    quiz_total: int = Field(ge=0)
    quiz_answered: int = Field(ge=0)


class LearningProgressNode(BaseModel):
    id: str
    name: str
    kind: Literal["subject", "palace", "chapter", "unit", "memory_point"]
    palace_id: int | None
    children: list["LearningProgressNode"]
    metrics: LearningProgressMetrics


class LearningProgressResponse(BaseModel):
    roots: list[LearningProgressNode]
    metrics: LearningProgressMetrics
    generated_at: str
    notes: list[str]


class _Coverage:
    def __init__(self) -> None:
        self.total: set[tuple[int, str]] = set()
        self.reviewed: set[tuple[int, str]] = set()
        self.due: set[tuple[int, str]] = set()
        self.questions: set[int] = set()

    def merge(self, other: "_Coverage") -> None:
        self.total.update(other.total)
        self.reviewed.update(other.reviewed)
        self.due.update(other.due)
        self.questions.update(other.questions)

    def metrics(self, answered: set[int]) -> dict[str, int]:
        return {
            "memory_total": len(self.total), "memory_reviewed": len(self.reviewed),
            "memory_due": len(self.due), "quiz_total": len(self.questions),
            "quiz_answered": len(self.questions & answered),
        }


def build_learning_progress(session: Session) -> dict[str, Any]:
    # Even a caller with unrelated dirty objects must never flush on this GET.
    with session.no_autoflush:
        catalog = read_learning_progress_catalog(session)
        evidence = read_learning_progress_evidence(session)
        quiz = read_learning_progress_quiz(session)
    answered = quiz["answered"]
    owned: dict[int, set[int]] = {}
    bound: dict[tuple[int, str], set[int]] = {}
    for question in quiz["questions"]:
        if question["palace_id"] is not None:
            owned.setdefault(question["palace_id"], set()).add(question["id"])
    for binding in quiz["bindings"]:
        bound.setdefault((binding["palace_id"], binding["node_uid"]), set()).add(binding["question_id"])

    def node(identity: str, name: str, kind: str, pid: int | None,
             children: list[dict[str, Any]], coverage: _Coverage) -> dict[str, Any]:
        return {"id": identity, "name": name, "kind": kind, "palace_id": pid,
                "children": children, "metrics": coverage.metrics(answered)}

    def scoped_node(value: dict[str, Any], scope: str) -> dict[str, Any]:
        return {**value, "id": f'{scope}/{value["id"]}',
                "children": [scoped_node(child, scope) for child in value["children"]]}

    roots: dict[int | None, tuple[dict[str, Any], _Coverage]] = {}
    for subject in catalog["subjects"]:
        coverage = _Coverage()
        roots[subject["id"]] = (node(f'subject:{subject["id"]}', subject["name"], "subject", None, [], coverage), coverage)
    global_coverage = _Coverage()
    integrity_warnings = list(catalog.get("warnings") or [])
    for palace in catalog["palaces"]:
        pid = palace["palace_id"]
        nodes = palace["nodes"]
        root_uid = palace["root_uid"]
        reviewed = evidence.get(pid, {}).get("reviewed", set())
        due = evidence.get(pid, {}).get("due", set())
        visited: set[str] = set()

        def branch(
            uid: str, depth: int, *, pid: int = pid,
            nodes: dict[str, Any] = nodes, visited: set[str] = visited,
            reviewed: set[str] = reviewed, due: set[str] = due,
        ) -> tuple[dict[str, Any], _Coverage] | None:
            if uid in visited or uid not in nodes:
                return None
            visited.add(uid)
            raw = nodes[uid]
            coverage = _Coverage()
            coverage.questions.update(bound.get((pid, uid), set()))
            children = []
            child_ids = raw.get("children") or []
            for child_uid in child_ids:
                child = branch(child_uid, depth + 1)
                if child:
                    children.append(child[0])
                    coverage.merge(child[1])
            if not child_ids:
                coverage.total.add((pid, uid))
                if uid in reviewed:
                    coverage.reviewed.add((pid, uid))
                if uid in due:
                    coverage.due.add((pid, uid))
            kind = "memory_point" if not child_ids else ("chapter" if depth == 1 else "unit")
            return node(f"palace:{pid}:node:{uid}", raw.get("text") or "未命名节点", kind, pid, children, coverage), coverage

        coverage = _Coverage()
        coverage.questions.update(owned.get(pid, set()))
        coverage.questions.update(bound.get((pid, root_uid), set()))
        children = []
        if root_uid in nodes:
            visited.add(root_uid)
            for uid in nodes[root_uid].get("children") or []:
                child = branch(uid, 1)
                if child:
                    children.append(child[0])
                    coverage.merge(child[1])
        palace_node = node(f"palace:{pid}", palace["title"] or "未命名宫殿", "palace", pid, children, coverage)
        subject_ids = [sid for sid in palace["subject_ids"] if sid in roots] or [None]
        for sid in subject_ids:
            if sid not in roots:
                empty = _Coverage()
                roots[sid] = (node("subject:unassigned", "未分类", "subject", None, [], empty), empty)
            subject_node, subject_coverage = roots[sid]
            subject_node["children"].append(scoped_node(palace_node, subject_node["id"]))
            subject_coverage.merge(coverage)
            subject_node["metrics"] = subject_coverage.metrics(answered)
        global_coverage.merge(coverage)
    return {
        "roots": [entry[0] for entry in roots.values()],
        "metrics": global_coverage.metrics(answered),
        "generated_at": datetime.now(UTC).isoformat(),
        "notes": [
            "记忆点仅统计当前非归档宫殿文档的非根叶节点；章节和单元保留真实文档层级。",
            "已复习表示当前有效复习单元的评分或通过记录覆盖，不代表掌握；过期拓扑证据不计入。",
            "已作答表示这道题有答题记录：答错也计入，重复作答仍计一道。清空当前练习轮次不会抹去已有答题记录。",
            "题目按身份去重；多学科和多节点绑定可能重叠，全局汇总不直接相加。未绑定到当前宫殿的章节题不在本页范围。",
            *(["源文档存在结构完整性问题，部分学习点可能无法归属；请修复文档后重试。"] if integrity_warnings else []),
        ],
    }
