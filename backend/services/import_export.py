"""导入导出服务 (支持层级桩，无标签)"""
import json, re
from sqlalchemy.orm import Session
from models import Palace, Peg


def _peg_tree(pegs) -> list[dict]:
    return [{"name": p.name, "content": p.content, "sort_order": p.sort_order,
             "children": _peg_tree(p.children or [])} for p in pegs]


def export_json(session: Session, palace_ids: list[int] | None = None) -> str:
    q = session.query(Palace)
    if palace_ids:
        q = q.filter(Palace.id.in_(palace_ids))
    data = [{
        "title": p.title, "description": p.description,
        "difficulty": p.difficulty, "review_mode": p.review_mode,
        "pegs": _peg_tree(p.pegs),
    } for p in q.all()]
    return json.dumps(data, ensure_ascii=False, indent=2)


def _peg_md(pegs, depth=0) -> list[str]:
    lines = []
    indent = "  " * depth
    for peg in pegs:
        lines.append(f"{indent}- **{peg.name}**: {peg.content}" if peg.name else f"{indent}- {peg.content}")
        if peg.children:
            lines.extend(_peg_md(peg.children, depth + 1))
    return lines


def export_markdown(session: Session, palace_ids: list[int] | None = None) -> str:
    q = session.query(Palace)
    if palace_ids:
        q = q.filter(Palace.id.in_(palace_ids))
    lines = []
    for p in q.all():
        lines.append(f"# {p.title}")
        lines.append("")
        lines.append(f"**难度**: {'★' * p.difficulty}{'☆' * (5 - p.difficulty)}")
        lines.append(f"**复习模式**: {p.review_mode}")
        lines.append("")
        if p.description:
            lines.append(p.description)
            lines.append("")
        if p.pegs:
            lines.append("## 记忆桩")
            lines.append("")
            lines.extend(_peg_md(p.pegs))
            lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


def _import_pegs(session: Session, palace_id: int, pegs_data: list[dict], parent_id: int | None = None):
    for i, pd in enumerate(pegs_data):
        peg = Peg(palace_id=palace_id, parent_id=parent_id,
                  name=pd.get("name", ""), content=pd.get("content", ""),
                  sort_order=pd.get("sort_order", i))
        session.add(peg)
        session.flush()
        if pd.get("children"):
            _import_pegs(session, palace_id, pd["children"], peg.id)


def import_json(session: Session, content: str) -> int:
    data = json.loads(content)
    if isinstance(data, dict):
        data = [data]
    count = 0
    for item in data:
        palace = Palace(title=item.get("title", ""), description=item.get("description", ""),
                        difficulty=item.get("difficulty", 3),
                        review_mode=item.get("review_mode", "flashcard"))
        session.add(palace)
        session.flush()
        _import_pegs(session, palace.id, item.get("pegs", []))
        count += 1
    session.commit()
    return count


def _parse_md_pegs(lines: list[str], start_idx: int, depth: int = 0):
    """解析 Markdown 层级桩，返回 (pegs_data, next_idx)"""
    pegs = []
    idx = start_idx
    indent = "  " * depth
    prefix = f"{indent}- "
    while idx < len(lines):
        line = lines[idx]
        if not line.startswith(prefix):
            break
        peg_line = line[len(prefix):]
        m = re.match(r'\*\*(.+?)\*\*:\s*(.*)', peg_line)
        if m:
            name, content = m.group(1), m.group(2)
        else:
            name, content = "", peg_line
        children = []
        next_idx = idx + 1
        # 检查下一行是否有更深的缩进
        deeper_prefix = f"{indent}  - "
        if next_idx < len(lines) and lines[next_idx].startswith(deeper_prefix):
            children, next_idx = _parse_md_pegs(lines, next_idx, depth + 1)
        pegs.append({"name": name, "content": content, "sort_order": len(pegs), "children": children})
        idx = next_idx
    return pegs, idx


def import_markdown(session: Session, content: str) -> int:
    blocks = re.split(r'\n(?=# )', content)
    count = 0
    for block in blocks:
        if not block.strip():
            continue
        lines = block.strip().split("\n")
        title = lines[0].lstrip("# ").strip()
        description_lines = []
        pegs_data = []
        difficulty = 3
        review_mode = "flashcard"
        in_pegs = False

        for line in lines[1:]:
            m = re.search(r'\*\*难度\*\*:\s*(★+)', line)
            if m:
                difficulty = len(m.group(1))
                continue
            if "**复习模式**:" in line:
                if "browse" in line:
                    review_mode = "browse"
                continue
            if line.strip().startswith("## 记忆桩"):
                in_pegs = True
                continue
            if in_pegs and line.strip().startswith("- "):
                pegs_data, _ = _parse_md_pegs(lines[lines.index(line):], 0)
                break
            if not line.startswith("#") and not line.startswith("**"):
                description_lines.append(line)

        palace = Palace(title=title, description="\n".join(description_lines).strip(),
                        difficulty=difficulty, review_mode=review_mode)
        session.add(palace)
        session.flush()
        _import_pegs(session, palace.id, pegs_data)
        count += 1
    session.commit()
    return count
