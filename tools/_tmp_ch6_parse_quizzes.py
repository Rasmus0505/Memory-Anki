# -*- coding: utf-8 -*-
"""Parse chapter 6 quizzes from Qwen VL OCR texts."""
from __future__ import annotations

import json
import re
from pathlib import Path

QDIR = Path(r"C:/Users/Administrator/Desktop/Qwen vl ocr/waijiao/waijiao_questions")
ADIR = Path(r"C:/Users/Administrator/Desktop/Qwen vl ocr/waijiao/waijiao_answers")
OUT = Path(r"D:/BaiduSyncdisk/Memory Anki/tools/_tmp_ch6_ocr/quizzes_parsed.json")

SECTIONS = [
    ("第一节", "夸美纽斯的教育思想", 70),
    ("第二节", "卢梭的教育思想", 71),
    ("第三节", "裴斯泰洛齐的教育思想", 72),
    ("第四节", "赫尔巴特的教育思想", 73),
    ("第五节", "福禄培尔的教育思想", 74),
    ("第六节", "马克思和恩格斯的教育思想", 75),
    ("第七节", "西欧近代教育思潮", 76),
]

SECTION_START = re.compile(
    r"第([一二三四五六七])节\s*([^\n]{0,40}?(?:教育思想|教育思潮))"
)
Q_START = re.compile(
    r"^(\d{1,2})\s*[\.．、]\s*(?:【([^】]+)】)?\s*(.*)$"
)
OPT = re.compile(r"^([A-D])\s*[\.．、。]?\s*(.*)$")
# answer patterns like: 1.D  or 1．D  or 1. D
ANS_LINE = re.compile(r"^(\d{1,2})\s*[\.．、]\s*([A-D])\b")
ANS_INLINE = re.compile(r"(\d{1,2})\s*[\.．、]\s*([A-D])")


def load_pages(folder: Path, prefix: str, start: int, end: int) -> str:
    parts = []
    for i in range(start, end + 1):
        p = folder / f"{prefix}_{i}.txt"
        if p.exists():
            parts.append(p.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(parts)


def normalize(s: str) -> str:
    s = s.replace("\u3000", " ")
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def compact(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def section_index(name: str) -> int | None:
    for i, (sec, title, _) in enumerate(SECTIONS):
        if sec in name or title in name or compact(title) in compact(name):
            return i
    return None


def parse_questions(text: str) -> dict[int, list[dict]]:
    # only from 第六章
    start = text.find("第六章")
    if start < 0:
        start = 0
    end = text.find("第七章")
    if end < 0:
        end = len(text)
    region = text[start:end]
    lines = [normalize(ln) for ln in region.splitlines() if normalize(ln)]

    current_sec = 0
    current_block = "真题典例"
    current_type = "multiple_choice"
    by_sec: dict[int, list[dict]] = {i: [] for i in range(7)}
    cur = None

    def flush():
        nonlocal cur
        if not cur:
            return
        if cur.get("stem") or cur.get("options"):
            opts = cur.pop("_opts", {})
            cur["options"] = [{"id": k, "text": normalize(opts[k])} for k in "ABCD" if k in opts]
            cur["stem"] = normalize(cur.get("stem", ""))
            # drop empty stems
            if cur["stem"] or cur["options"]:
                by_sec[cur["section"]].append(cur)
        cur = None

    i = 0
    while i < len(lines):
        ln = lines[i]
        # section headers
        m = SECTION_START.search(ln) or (
            re.match(r"第([一二三四五六七])节$", ln)
            and i + 1 < len(lines)
            and SECTION_START.search(ln + lines[i + 1])
        )
        if "第" in ln and "节" in ln:
            for idx, (sec, title, _) in enumerate(SECTIONS):
                if sec in ln or (title[:4] in ln):
                    # also next line may have title
                    flush()
                    current_sec = idx
                    i += 1
                    continue
            # standalone section number line
            m2 = re.match(r"第([一二三四五六七])节$", ln)
            if m2:
                mapping = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "七": 6}
                flush()
                current_sec = mapping.get(m2.group(1), current_sec)
                i += 1
                continue
            for idx, (sec, title, _) in enumerate(SECTIONS):
                if title in ln or compact(title) in compact(ln):
                    flush()
                    current_sec = idx
                    i += 1
                    continue

        if "真题典例" in ln:
            current_block = "真题典例"
            i += 1
            continue
        if "模拟练习" in ln:
            current_block = "模拟练习"
            i += 1
            continue
        if re.search(r"单项选择题|选择题", ln) and len(ln) < 20:
            current_type = "multiple_choice"
            i += 1
            continue
        if re.search(r"论述题|分析论述题|材料分析题", ln) and len(ln) < 30:
            flush()
            current_type = "essay" if "材料" not in ln else "material_analysis"
            i += 1
            continue

        qm = Q_START.match(ln)
        if qm and (current_type != "multiple_choice" or True):
            # new question if number restarts or continues
            num = int(qm.group(1))
            year_tag = qm.group(2) or ""
            rest = qm.group(3) or ""
            # heuristic: if multiple_choice and stem ends soon with options on same/next lines
            flush()
            stem = rest
            if year_tag:
                stem = f"【{year_tag}】{stem}"
            qtype = current_type
            # essays often start with 试/论述/简评
            if re.match(r"^(试|论述|简评|评述|阅读|结合)", rest) or current_type in {
                "essay",
                "material_analysis",
                "short_answer",
            }:
                if "分析论述" in (year_tag + rest) or current_type == "material_analysis":
                    qtype = "essay" if "材料" not in current_type else "material_analysis"
                elif current_type == "essay" or re.match(r"^(试|论述|简评|评述)", rest):
                    qtype = "essay"
            cur = {
                "section": current_sec,
                "block": current_block,
                "question_type": qtype if qtype != "multiple_choice" or not re.match(r"^(试|论述|简评|评述|阅读)", rest) else (
                    "essay" if re.match(r"^(试|论述|简评|评述|阅读)", rest) else "multiple_choice"
                ),
                "number": num,
                "stem": stem,
                "_opts": {},
                "source_page_hint": None,
            }
            # fix type for essay-like stems
            if re.match(r"^(试|论述|简评|评述|阅读|结合所学)", rest):
                cur["question_type"] = "essay" if not rest.startswith("阅读") else "material_analysis"
            i += 1
            continue

        # options or continuation
        if cur is not None:
            om = OPT.match(ln)
            if om and cur["question_type"] == "multiple_choice":
                cur["_opts"][om.group(1).upper()] = om.group(2)
                i += 1
                continue
            # multi-option same line: A.xxx B.xxx
            if cur["question_type"] == "multiple_choice" and re.search(r"[A-D]\s*[\.．]", ln):
                for mopt in re.finditer(r"([A-D])\s*[\.．、]?\s*([^A-D]+?)(?=(?:[A-D]\s*[\.．、])|$)", ln):
                    cur["_opts"][mopt.group(1)] = normalize(mopt.group(2))
                if cur["_opts"]:
                    i += 1
                    continue
            # continuation of stem / essay body
            if not re.match(r"^(第[一二三四五六七]节|真题|模拟|一、|二、|三、)", ln) and not re.match(
                r"^\d{2,3}$", ln
            ):
                # skip page footers
                if "第三部分" in ln or "外国教育史" in ln or "后续更新" in ln:
                    i += 1
                    continue
                if "第六章" in ln and len(ln) < 30:
                    i += 1
                    continue
                cur["stem"] = normalize(cur["stem"] + ln)
                i += 1
                continue
        i += 1
    flush()
    return by_sec


def parse_answers(text: str) -> dict[int, dict]:
    """Return {section: {block: {qtype: {num: {answer, analysis}}}}} roughly."""
    start = text.find("第六章")
    if start < 0:
        start = 0
    end = text.find("第七章")
    if end < 0:
        end = len(text)
    region = text[start:end]
    lines = [normalize(ln) for ln in region.splitlines() if normalize(ln)]

    current_sec = 0
    current_block = "真题典例"
    current_type = "multiple_choice"
    # store list of answer items per section
    by_sec: dict[int, list[dict]] = {i: [] for i in range(7)}
    cur = None

    def flush():
        nonlocal cur
        if cur and (cur.get("answer") or cur.get("analysis") or cur.get("reference_answer")):
            by_sec[cur["section"]].append(cur)
        cur = None

    i = 0
    while i < len(lines):
        ln = lines[i]
        if "第" in ln and "节" in ln:
            for idx, (sec, title, _) in enumerate(SECTIONS):
                if sec in ln or title[:4] in ln:
                    flush()
                    current_sec = idx
                    break
            m2 = re.match(r"第([一二三四五六七])节$", ln)
            if m2:
                mapping = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "七": 6}
                flush()
                current_sec = mapping.get(m2.group(1), current_sec)
                i += 1
                continue
        if "真题典例" in ln:
            current_block = "真题典例"
            i += 1
            continue
        if "模拟练习" in ln:
            current_block = "模拟练习"
            i += 1
            continue
        if re.search(r"单项选择题|选择题", ln) and len(ln) < 20:
            current_type = "multiple_choice"
            i += 1
            continue
        if re.search(r"论述题|分析论述题|材料分析题|参考答案", ln) and len(ln) < 30:
            flush()
            if "材料" in ln:
                current_type = "material_analysis"
            elif "论述" in ln or "分析" in ln:
                current_type = "essay"
            i += 1
            continue

        # MC answer: 1.D or 1．D 本题...
        am = re.match(r"^(\d{1,2})\s*[\.．、]\s*([A-D])(?:\s*[．.。]?\s*)?(.*)$", ln)
        if am and current_type == "multiple_choice":
            flush()
            num = int(am.group(1))
            ans = am.group(2).upper()
            rest = am.group(3) or ""
            cur = {
                "section": current_sec,
                "block": current_block,
                "question_type": "multiple_choice",
                "number": num,
                "answer": ans,
                "analysis": rest,
            }
            i += 1
            continue

        # essay answer start: 1. ... or （1）
        em = re.match(r"^(\d{1,2})\s*[\.．、]\s*(.*)$", ln)
        if em and current_type in {"essay", "material_analysis", "short_answer"}:
            flush()
            cur = {
                "section": current_sec,
                "block": current_block,
                "question_type": current_type,
                "number": int(em.group(1)),
                "reference_answer": em.group(2) or "",
                "analysis": "",
            }
            i += 1
            continue

        if cur is not None:
            if "第三部分" in ln or "外国教育史" in ln or "后续更新" in ln:
                i += 1
                continue
            if re.match(r"^\d{2,3}$", ln):
                i += 1
                continue
            if cur["question_type"] == "multiple_choice":
                cur["analysis"] = normalize((cur.get("analysis") or "") + ln)
            else:
                cur["reference_answer"] = normalize((cur.get("reference_answer") or "") + ln)
            i += 1
            continue
        i += 1
    flush()
    return by_sec


def merge(qs: dict[int, list[dict]], ans: dict[int, list[dict]]) -> dict:
    result = {}
    for idx, (sec, title, ch_id) in enumerate(SECTIONS):
        qlist = qs.get(idx, [])
        alist = ans.get(idx, [])
        # index answers by (block, type, number)
        amap = {}
        for a in alist:
            key = (a.get("block"), a.get("question_type"), a.get("number"))
            amap.setdefault(key, []).append(a)
            # also looser key by number+type
            amap.setdefault((None, a.get("question_type"), a.get("number")), []).append(a)

        merged = []
        used = set()
        for qi, q in enumerate(qlist):
            key = (q.get("block"), q.get("question_type"), q.get("number"))
            candidates = amap.get(key) or amap.get((None, q.get("question_type"), q.get("number"))) or []
            a = None
            for c in candidates:
                cid = id(c)
                if cid not in used:
                    a = c
                    used.add(cid)
                    break
            item = {
                "section": sec,
                "title": title,
                "chapter_id": ch_id,
                "block": q.get("block"),
                "question_type": q.get("question_type"),
                "number": q.get("number"),
                "stem": q.get("stem"),
                "options": q.get("options") or [],
            }
            if a:
                if q.get("question_type") == "multiple_choice":
                    item["answer"] = a.get("answer")
                    item["analysis"] = a.get("analysis")
                else:
                    item["reference_answer"] = a.get("reference_answer") or a.get("analysis")
                    item["analysis"] = a.get("analysis") if a.get("reference_answer") else ""
            merged.append(item)
        # leftover answers without matched questions (essays only in answers etc.)
        for a in alist:
            if id(a) in used:
                continue
            item = {
                "section": sec,
                "title": title,
                "chapter_id": ch_id,
                "block": a.get("block"),
                "question_type": a.get("question_type"),
                "number": a.get("number"),
                "stem": "",
                "options": [],
                "answer": a.get("answer"),
                "reference_answer": a.get("reference_answer"),
                "analysis": a.get("analysis"),
                "answer_only": True,
            }
            merged.append(item)
        result[f"{sec}{title}"] = {
            "section": sec,
            "title": title,
            "chapter_id": ch_id,
            "count": len(merged),
            "questions": merged,
        }
    return result


def main() -> None:
    qtext = load_pages(QDIR, "waijiao_questions", 12, 16)
    atext = load_pages(ADIR, "waijiao_answers", 12, 21)
    # also include page 17 start if ch6 ends there - already truncated by 第七章
    qs = parse_questions(qtext)
    ans = parse_answers(atext)
    for i in range(7):
        print(f"sec{i+1} Q={len(qs.get(i,[]))} A={len(ans.get(i,[]))}")
        for q in qs.get(i, [])[:3]:
            print("  Q", q.get("number"), q.get("question_type"), (q.get("stem") or "")[:60])
        for a in ans.get(i, [])[:3]:
            print("  A", a.get("number"), a.get("question_type"), a.get("answer"), (a.get("analysis") or a.get("reference_answer") or "")[:50])
    merged = merge(qs, ans)
    OUT.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
