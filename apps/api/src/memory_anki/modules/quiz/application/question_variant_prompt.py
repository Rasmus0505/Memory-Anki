"""Build the copy-ready prompt for an external AI rewrite batch."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.content.public.queries import resolve_palace_title
from memory_anki.modules.mindmap_document.api import build_document_tree

from .question_variants import effective_content, resolved_active_version_id

MAX_BOUND_NODES = 8
MAX_CHILD_NODES = 8

MUTATION_PROMPT_HEADER = """你现在是一位资深的考研 333 教育综合与专业课命题专家。下面这些题我已经做过多次，形成了“看题干前半句或记住选项位置就秒选”的肌肉记忆，失去了诊断价值。

请结合每道题附带的【原题、原解析】及【bound_nodes（绑定导图节点上下文）】，为每道题生成 1 道全新的高质量变体题，用于替换原题的展现形式。

【核心命题准则（决定题目质量，务必严格执行）】

1. 锚定核心考点与「错绑节点豁免」：
   - 优先提取 bound_nodes 中的知识点、易错提示（note）和子节点（children）来设计题目与干扰项。
   - 【重要豁免】：如果发现某道题的 bound_nodes 内容与原题干/原解析的考点明显不相关（属于历史错绑，例如原题考“庆历兴学”，绑定节点却是“书院”），请直接忽略 bound_nodes，严格围绕【原题与原解析的核心考点】及同章节考纲常识进行变形！
   - 严禁超纲与幻觉：所有人物、制度、著作、定义必须符合 333 教育综合 / 考研政治权威教材标准，严禁生造不存在的史实或概念。

2. 彻底打破肌肉记忆（3 种强制变形模具，按原题类型三选一）：
   - 【模具 A：针对史实/人物/制度题 —— 改为“张冠李戴·四维综合辨析”】
     不要再单问“某次兴学的措施是什么”或“首次立学的是谁”。请改为：“关于[该章节核心主题，如北宋三次兴学/某教育家思想]的叙述，下列匹配/表述正确（或错误）的是（ ）”，在 A/B/C/D 四个选项中分别放入同章节不同人物/时期的措施并进行交叉错位（张冠李戴，如把王安石的“三舍法”嫁接给范仲淹，把胡瑗的“苏湖教法”说成明代制度），逼迫做题者必须逐一审视全部 4 个选项才能作答！
   - 【模具 B：针对概念/分类/定义题 —— 改为“逆向情境匹配”或“判断变式”】
     原题若是“给例子选概念”，新题请改为“给出四个不同情境/表述与概念的对应关系，选出对应完全正确的一项”；或者换用同层级的兄弟概念设问（如原题考“庆历兴学”，新题改为考原题干扰项中的“熙宁兴学”或“崇宁兴学”的核心创举）。
   - 【模具 C：针对简答/论述题（非选择题）—— 改为“侧重点追问与对比设问”】
     保持考点不变，改变提问切入角（如原题问“简述庆历兴学的内容”，新题改为“对比庆历兴学与熙宁兴学在太学改革与科举调整上的异同，并简述庆历兴学的主要措施”），答案依然沿用并覆盖原参考答案的核心采分点。

3. 高质量干扰项铁律（拒绝一眼假的弱智选项）：
   - 严禁编写带有“只、全部、彻底废除、毫无作用”等绝对化词汇的凑数干扰项（如“只在中央设国子监”）。
   - 所有错误选项必须是真实存在的同章节兄弟概念（用张冠李戴、时间先后颠倒、主次颠倒、因果倒置来设陷）。
   - 正确答案的位置（A/B/C/D）必须与原题的正确答案位置不同！

4. 来源标签与幂等规则：
   - 若原题 stem 开头带有 【...】 来源标签（如 【333·中教史·第四章】），请原样保留在最前面，并在其后紧跟一个 【AI变体】 标签。
   - 如果原题 stem 中已经包含 【AI变体】 字样，请保留原有的 【AI变体】，绝对不要重复叠加成 【AI变体】【AI变体】。若原题无任何标签，则直接在开头加上 【AI变体】。

5. 结构与字段映射规范（防导入报错）：
   - 无论输入数据中使用的是 question_id 还是 id，输出时一律统一命名为 "question_id"。
   - 无论输入数据中使用的是 base_version_id 还是 baseVersionId，输出时一律统一命名为 "base_version_id"，且其值必须原样照抄输入值（如 "v1" 或 "original"）。
   - 必须保持与原题完全相同的 question_type 和 answer_payload 内部键结构（单选为 {"correct_option_id": "X"}，多选为 {"correct_option_ids": ["X", "Y"]}，简答为 {"reference_answer": "..."}）。
   - analysis 解析必须结构化：先明确指出正确答案的核心依据，再按 A/B/C/D 顺序逐一拆解每个干扰项具体错在何处（谁的措施、哪个朝代、怎么改才对）。

【输出格式要求】
只输出一个合法的、可直接被 JSON.parse() 解析的 JSON 数组！严禁输出任何开场白、结束语、解释文字或 ```json 代码块包裹符号。数组每项格式严格如下：
[
  {
    "question_id": 1024,
    "base_version_id": "original",
    "question_type": "multiple_choice",
    "stem": "新题干",
    "options": [
      {"id": "A", "text": "选项内容（不含A.前缀）"},
      {"id": "B", "text": "选项内容"},
      {"id": "C", "text": "选项内容"},
      {"id": "D", "text": "选项内容"}
    ],
    "answer_payload": {"correct_option_id": "A"},
    "analysis": "解析内容：先说明正确依据，再按 A/B/C/D 逐一说明干扰项错在哪里"
  }
]

以下是需要你变形替换的题目数据：
"""


def _node_context(
    palace: Palace | None,
    node_uid: str,
    tree_cache: dict[int, tuple[str | None, dict[str, dict[str, Any]]]],
) -> dict[str, Any] | None:
    if palace is None or palace.id is None:
        return None
    palace_id = int(palace.id)
    if palace_id not in tree_cache:
        tree_cache[palace_id] = build_document_tree(getattr(palace, "editor_doc", None))
    _root_uid, nodes = tree_cache[palace_id]
    node = nodes.get(node_uid)
    if node is None:
        return None
    path = [
        str(entry.get("text") or "").strip()
        for entry in node.get("ancestor_path", [])
        if str(entry.get("text") or "").strip()
    ]
    child_texts = [
        str(nodes[child_uid].get("text") or "").strip()
        for child_uid in node.get("children", [])[:MAX_CHILD_NODES]
        if child_uid in nodes and str(nodes[child_uid].get("text") or "").strip()
    ]
    return {
        "palace": resolve_palace_title(palace),
        "node_uid": node_uid,
        "path": path,
        "node": str(node.get("text") or "").strip(),
        "note": str(node.get("note") or "").strip(),
        "children": child_texts,
    }


def build_mutation_prompt(session: Session, question_ids: list[int]) -> dict[str, Any]:
    normalized_ids: list[int] = []
    seen: set[int] = set()
    for raw in question_ids:
        try:
            question_id = int(raw)
        except (TypeError, ValueError):
            continue
        if question_id <= 0 or question_id in seen:
            continue
        seen.add(question_id)
        normalized_ids.append(question_id)
    if not normalized_ids:
        return {"text": MUTATION_PROMPT_HEADER + "[]", "question_count": 0, "skipped_count": 0}

    questions = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.id.in_(normalized_ids),
            PalaceQuizQuestion.deleted_at.is_(None),
            PalaceQuizQuestion.needs_mutation.is_(True),
        )
        .order_by(PalaceQuizQuestion.id.asc())
        .all()
    )
    if not questions:
        return {
            "text": MUTATION_PROMPT_HEADER + "[]",
            "question_count": 0,
            "skipped_count": len(normalized_ids),
        }

    question_ids_found = {int(question.id) for question in questions}
    edge_rows = (
        session.query(PalaceQuizQuestionNodeBinding)
        .filter(PalaceQuizQuestionNodeBinding.question_id.in_(question_ids_found))
        .order_by(
            PalaceQuizQuestionNodeBinding.question_id.asc(),
            PalaceQuizQuestionNodeBinding.palace_id.asc(),
            PalaceQuizQuestionNodeBinding.node_uid.asc(),
        )
        .all()
    )
    target_palace_ids = {int(row.palace_id) for row in edge_rows if row.palace_id}
    palaces = {
        int(palace.id): palace
        for palace in session.query(Palace)
        .filter(Palace.id.in_(target_palace_ids))
        .all()
        if palace.id is not None
    }
    edges_by_question: dict[int, list[PalaceQuizQuestionNodeBinding]] = {}
    for row in edge_rows:
        edges_by_question.setdefault(int(row.question_id), []).append(row)

    tree_cache: dict[int, tuple[str | None, dict[str, dict[str, Any]]]] = {}
    data: list[dict[str, Any]] = []
    for question in questions:
        content = effective_content(question)
        bound_nodes: list[dict[str, Any]] = []
        for edge in edges_by_question.get(int(question.id), [])[:MAX_BOUND_NODES]:
            context = _node_context(
                palaces.get(int(edge.palace_id)),
                str(edge.node_uid),
                tree_cache,
            )
            if context is not None:
                bound_nodes.append(context)
        data.append(
            {
                "question_id": int(question.id),
                "base_version_id": resolved_active_version_id(question),
                "question_type": content["question_type"],
                "stem": content["stem"],
                "options": content["options"],
                "answer_payload": content["answer_payload"],
                "analysis": content["analysis"],
                "bound_nodes": bound_nodes,
            }
        )
    return {
        "text": MUTATION_PROMPT_HEADER
        + json.dumps(data, ensure_ascii=False, indent=2),
        "question_count": len(data),
        "skipped_count": len(normalized_ids) - len(question_ids_found),
    }


__all__ = ["MUTATION_PROMPT_HEADER", "build_mutation_prompt"]
