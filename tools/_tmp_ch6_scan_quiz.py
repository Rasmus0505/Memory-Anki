# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path

Q = Path(r"C:/Users/Administrator/Desktop/Qwen vl ocr/waijiao/waijiao_questions")
A = Path(r"C:/Users/Administrator/Desktop/Qwen vl ocr/waijiao/waijiao_answers")
OUT = Path(r"D:/BaiduSyncdisk/Memory Anki/tools/_tmp_ch6_ocr")
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    print("Q files", len(list(Q.glob("*.txt"))), sorted(p.name for p in Q.glob("*.txt")))
    print("A files", len(list(A.glob("*.txt"))), sorted(p.name for p in A.glob("*.txt")))
    for folder, label in [(Q, "Q"), (A, "A")]:
        for p in sorted(folder.glob("*.txt"), key=lambda x: int(x.stem.split("_")[-1])):
            t = p.read_text(encoding="utf-8", errors="ignore")
            keys = []
            for k in [
                "第六章",
                "第五章",
                "第七章",
                "夸美纽斯",
                "卢梭",
                "裴斯泰洛齐",
                "赫尔巴特",
                "福禄培尔",
                "马克思",
                "恩格斯",
                "教育思潮",
                "第一节",
                "第二节",
                "第三节",
                "第四节",
                "第五节",
                "第六节",
                "第七节",
            ]:
                if k in t:
                    keys.append(k)
            if keys:
                print(f"{label} {p.name}: {keys}")
    # dump chapter 6 region
    q_parts = []
    for p in sorted(Q.glob("*.txt"), key=lambda x: int(x.stem.split("_")[-1])):
        t = p.read_text(encoding="utf-8", errors="ignore")
        if "第六章" in t or "夸美纽斯" in t or "西欧近代教育思想" in t:
            q_parts.append(f"===== {p.name} =====\n{t}")
    (OUT / "quiz_q_ch6_raw.txt").write_text("\n\n".join(q_parts), encoding="utf-8")
    a_parts = []
    for p in sorted(A.glob("*.txt"), key=lambda x: int(x.stem.split("_")[-1])):
        t = p.read_text(encoding="utf-8", errors="ignore")
        if any(
            k in t
            for k in [
                "第六章",
                "夸美纽斯",
                "卢梭的教育思想",
                "裴斯泰洛齐",
                "赫尔巴特",
                "福禄培尔",
                "马克思和恩格斯",
                "西欧近代教育思潮",
            ]
        ):
            a_parts.append(f"===== {p.name} =====\n{t}")
    (OUT / "quiz_a_ch6_raw.txt").write_text("\n\n".join(a_parts), encoding="utf-8")
    print("wrote quiz raw", len(q_parts), len(a_parts))


if __name__ == "__main__":
    main()
