from __future__ import annotations

import json
from pathlib import Path


OUT_ROOT = Path(r"D:\我的网站\Memory Anki\output\1000题_visual_work")


CHAPTERS = {
    "教育学原理": [
        "第一章 教育及其产生与发展",
        "第二章 教育与社会发展",
        "第三章 教育与人的发展",
        "第四章 教育目的与培养目标",
        "第五章 教育制度",
        "第六章 课程",
        "第七章 教学",
        "第八章 德育",
        "第九章 教师与学生",
    ],
    "中国教育史": [
        "第一章 官学制度的建立与“六艺”教育的形成",
        "第二章 私人讲学的兴起与传统教育思想的奠基",
        "第三章 儒学独尊与读经做官教育模式的初步形成",
        "第四章 封建国家教育体制的完善",
        "第五章 理学教育思想和学校的改革与发展",
        "第六章 近代教育的起步",
        "第七章 近代教育体系的建立",
        "第八章 近代教育体制的变革",
        "第九章 国民政府时期的教育和中国共产党领导下的革命根据地教育",
        "第十章 现代教育家的教育理论与实践",
    ],
    "外国教育史": [
        "第一章 东方文明古国和古希腊的教育",
        "第二章 古罗马的教育",
        "第三章 西欧中世纪的教育",
        "第四章 文艺复兴与宗教改革时期的教育",
        "第五章 欧美主要国家和日本的近代教育",
        "第六章 西欧近代教育思想与教育思潮",
        "第七章 19世纪末至20世纪前期欧美教育思潮和教育实验",
        "第八章 欧美主要国家和日本的现代教育制度",
        "第九章 现代欧美教育思想",
    ],
    "教育心理学": [
        "第一章 心理发展与教育",
        "第二章 学习及其理论解释",
        "第三章 学习动机",
        "第四章 知识的建构",
        "第五章 技能的形成",
        "第六章 学习策略及其教学",
        "第七章 问题解决能力与创造性的培养",
        "第八章 态度与品德的学习",
    ],
    "附录": [
        "附录一 全国硕士研究生招生考试教育专业学位硕士教育综合考试样卷参考答案",
        "附录二 2024年全国硕士研究生招生考试教育综合试题参考答案",
        "附录三 2025年全国硕士研究生招生考试教育综合试题参考答案",
    ],
}


def main() -> int:
    final_root = OUT_ROOT / "final_markdown"
    final_root.mkdir(parents=True, exist_ok=True)
    records = []
    for part, chapters in CHAPTERS.items():
        part_dir = final_root / part
        part_dir.mkdir(parents=True, exist_ok=True)
        for index, title in enumerate(chapters, start=1):
            filename = f"{index:02d}_{title.replace(' ', '_').replace('/', '_')}.md"
            path = part_dir / filename
            records.append({"part": part, "index": index, "title": title, "path": str(path)})
    manifest_path = OUT_ROOT / "chapter_manifest.json"
    manifest_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(manifest_path)
    print(len(records), "chapter files planned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
