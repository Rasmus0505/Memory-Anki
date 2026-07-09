"""Import/export helpers for palace data."""

import json
import re

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, Peg


def _peg_tree(pegs) -> list[dict]:
    return [
        {
            "name": peg.name,
            "content": peg.content,
            "sort_order": peg.sort_order,
            "children": _peg_tree(peg.children or []),
        }
        for peg in pegs
    ]


def export_json(session: Session, palace_ids: list[int] | None = None) -> str:
    query = session.query(Palace)
    if palace_ids:
        query = query.filter(Palace.id.in_(palace_ids))
    data = [
        {
            "title": palace.title,
            "description": palace.description,
            "pegs": _peg_tree(palace.pegs),
        }
        for palace in query.all()
    ]
    return json.dumps(data, ensure_ascii=False, indent=2)


def _peg_md(pegs, depth: int = 0) -> list[str]:
    lines: list[str] = []
    indent = "  " * depth
    for peg in pegs:
        lines.append(f"{indent}- **{peg.name}**: {peg.content}" if peg.name else f"{indent}- {peg.content}")
        if peg.children:
            lines.extend(_peg_md(peg.children, depth + 1))
    return lines


def export_markdown(session: Session, palace_ids: list[int] | None = None) -> str:
    query = session.query(Palace)
    if palace_ids:
        query = query.filter(Palace.id.in_(palace_ids))
    lines: list[str] = []
    for palace in query.all():
        lines.append(f"# {palace.title}")
        lines.append("")
        if palace.description:
            lines.append(palace.description)
            lines.append("")
        if palace.pegs:
            lines.append("## 记忆 peg")
            lines.append("")
            lines.extend(_peg_md(palace.pegs))
            lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


def _import_pegs(session: Session, palace_id: int, pegs_data: list[dict], parent_id: int | None = None):
    for index, peg_data in enumerate(pegs_data):
        peg = Peg(
            palace_id=palace_id,
            parent_id=parent_id,
            name=peg_data.get("name", ""),
            content=peg_data.get("content", ""),
            sort_order=peg_data.get("sort_order", index),
        )
        session.add(peg)
        session.flush()
        if peg_data.get("children"):
            _import_pegs(session, palace_id, peg_data["children"], peg.id)


def import_json(session: Session, content: str) -> int:
    data = json.loads(content)
    if isinstance(data, dict):
        data = [data]
    count = 0
    for item in data:
        palace = Palace(
            title=item.get("title", ""),
            description=item.get("description", ""),
            difficulty=0,
            review_mode="review",
        )
        session.add(palace)
        session.flush()
        _import_pegs(session, palace.id, item.get("pegs", []))
        count += 1
    session.commit()
    return count


def _parse_md_pegs(lines: list[str], start_idx: int, depth: int = 0):
    pegs: list[dict[str, object]] = []
    index = start_idx
    indent = "  " * depth
    prefix = f"{indent}- "
    while index < len(lines):
        line = lines[index]
        if not line.startswith(prefix):
            break
        peg_line = line[len(prefix):]
        match = re.match(r"\*\*(.+?)\*\*:\s*(.*)", peg_line)
        if match:
            name, content = match.group(1), match.group(2)
        else:
            name, content = "", peg_line
        children = []
        next_index = index + 1
        deeper_prefix = f"{indent}  - "
        if next_index < len(lines) and lines[next_index].startswith(deeper_prefix):
            children, next_index = _parse_md_pegs(lines, next_index, depth + 1)
        pegs.append({"name": name, "content": content, "sort_order": len(pegs), "children": children})
        index = next_index
    return pegs, index


def import_markdown(session: Session, content: str) -> int:
    blocks = re.split(r"\n(?=# )", content)
    count = 0
    for block in blocks:
        if not block.strip():
            continue
        lines = block.strip().split("\n")
        title = lines[0].lstrip("# ").strip()
        description_lines: list[str] = []
        pegs_data: list[dict] = []
        in_pegs = False

        for line in lines[1:]:
            if line.strip().startswith("## 记忆 peg"):
                in_pegs = True
                continue
            if in_pegs and line.strip().startswith("- "):
                pegs_data, _ = _parse_md_pegs(lines[lines.index(line):], 0)
                break
            if not line.startswith("#"):
                description_lines.append(line)

        palace = Palace(
            title=title,
            description="\n".join(description_lines).strip(),
            difficulty=0,
            review_mode="review",
        )
        session.add(palace)
        session.flush()
        _import_pegs(session, palace.id, pegs_data)
        count += 1
    session.commit()
    return count
