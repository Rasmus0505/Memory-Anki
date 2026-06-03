from __future__ import annotations

import json
from typing import Any

from .contracts import PROMPT_TEXT_MAX_CHARS, PdfImportOptions

PROMPT = """你是一个严格输出 JSON 的思维导图识别助手。

任务：读取用户给出的中文图片，把其中的层级结构尽量一比一还原成树形结构。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 保留原文措辞，不要总结，不要改写。
3. 尽量保留原图层级、分组、项目符号顺序。
4. 输出格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "children": []
    }
  ]
}
5. 如果某个节点没有子节点，children 仍然输出空数组。
6. 如果图里存在明显主标题，放到 title；否则给空字符串。
7. 不要添加图片里不存在的内容。
8. 如果某个节点内容明显包含多个并列要点，不要把所有说明塞进一个超长节点；应改成一个较短的父节点标题，并把并列要点拆成多个 children。
9. 单个节点 text 尽量简洁，优先保留脑图式短语，而不是大段整句。
"""

BATCH_PROMPT = """你是一个严格输出 JSON 的教材转思维导图补全助手。

任务：
1. 第一张被指定为结构图的图片提供章节原始思维导图结构。
2. 其余图片提供该章节教材正文。
3. 你需要基于已提取出的原始导图结构，把正文内容补充到最匹配的节点下，输出增强后的完整树。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层 JSON 格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "children": []
    }
  ]
}
3. 结构图中原有节点标题尽量保留原文，不要随意改写。
4. 正文内容必须补到最匹配的原节点下；允许新增多级子节点，不要求只补一层。
5. 如果正文内容无法精确匹配到叶子节点，宁可补到更高层级的相关节点下，也不要挂错位置。
6. 不要捏造图片里不存在的知识点。
7. 每个节点即使没有子节点，也必须输出 children: []。
8. 如果结构图没有明显标题，可以保留给定结构里的 title。
9. 如果某个原节点下补充出的正文本质上是多个并列要点，不要塞成一个超长节点；请拆成多个并列 children。
10. 单个节点 text 尽量保持脑图风格，避免过长整段。
"""

TEXT_PROMPT = """你是一个严格输出纯文本的图片转文字助手。

任务：读取用户给出的中文图片，把图中的文字尽量完整、逐行地转成纯文本。

强制要求：
1. 只输出纯文本，不要输出 markdown，不要输出 JSON，不要输出解释。
2. 保留原文措辞，不要总结，不要改写。
3. 尽量保留原图中的段落、换行、列表顺序和层次缩进。
4. 不要添加图片里不存在的内容。
5. 如果有明显标题，保留在最前面。
"""

PDF_PAGE_CONTEXT_PROMPT = """附加约束：
1. 只处理本次给出的 PDF 选定页面，不要假设整本书的其他页面内容。
2. 用户给出的页码范围和自然语言提示只是帮助你聚焦本次识别范围，不能编造未出现的内容。
"""


def build_pdf_structure_prompt(*, preserve_emphasis_marks: bool) -> str:
    lines = [
        "你是一个严格输出 JSON 的 PDF 脑图结构还原助手。",
        "",
        "任务：只读取用户指定的 PDF 结构页，把页面中原本就存在的脑图结构还原成树形结构。",
        "",
        "强制要求：",
        "1. 只输出 JSON，不要输出 markdown，不要输出解释。",
        "2. 必须保留原页的章节主干、层级、顺序和节点粒度。",
        "3. 禁止改写、概括、压缩或重命名原始节点文字。",
    ]
    lines.extend(
        [
            "5. 输出格式必须为：",
            "{",
            '  "title": "根节点标题",',
            '  "children": [',
            "    {",
            '      "text": "节点文字",',
            '      "rich_text_html": "<div>节点文字</div>",',
            '      "emphasis_marks": [],',
            '      "children": []',
            "    }",
            "  ]",
            "}",
            "6. 如果某个节点没有子节点，children 仍然输出空数组。",
        ]
    )
    if preserve_emphasis_marks:
        lines.append("7. 如果原节点带有下划线或波浪线强调，必须在结果里保留强调信息。")
    else:
        lines.append("7. 无需额外保留下划线或波浪线强调，只需正确识别节点文字即可。")
    return "\n".join(lines)


def build_pdf_batch_prompt(
    *,
    structure_tree: dict[str, Any],
    range_prompt: str,
    page_numbers: list[int] | None,
    import_options: PdfImportOptions,
    extracted_text: str | None,
) -> str:
    lines = [
        "你是一个严格输出 JSON 的 PDF 脑图正文补充助手。",
        "",
        "任务：",
        "1. 第一张图片是已经指定的 PDF 结构页，对应的脑图结构 JSON 已给出。",
        "2. 其余图片是正文页。",
        "3. 你需要基于已给定的结构，把正文内容补充到最匹配的原始节点下。",
        "",
        "强制要求：",
        "1. 只输出 JSON，不要输出 markdown，不要输出解释。",
    ]
    lines.append("2. 给定结构里的原始节点 text、层级、顺序必须保持不变；你只能在原节点下面新增 children。")
    if import_options.mount_on_original_leaf_only:
        lines.append("3. 默认只在最小原始节点下面新增 children；除非叶子节点实在无法承接，否则不要挂到更高层原节点。")
    else:
        lines.append("3. 如果正文无法精确匹配到叶子节点，可以挂到最近的相关原始父节点下，但仍然不能改动原始结构节点。")
    if import_options.quote_original_text_only:
        lines.append("4. 补充内容必须尽量使用原话，不要概括或改写。")
    else:
        lines.append("4. 补充内容可以提炼成更适合脑图展示的短语，但必须忠实原文，不能捏造。")
    if import_options.semantic_split_long_paragraphs:
        lines.append("5. 如果正文本质上包含多个并列要点，请拆成多个并列 children，而不是塞进一个超长节点。")
    else:
        lines.append("5. 不要为了美化结构自动把长段正文拆成多个并列 children，除非原文本身就是明显列举。")
    if import_options.preserve_emphasis_marks:
        lines.append("6. 如果正文中存在下划线或波浪线强调，必须在对应补充节点保留强调信息。")
    else:
        lines.append("6. 无需额外保留下划线或波浪线强调，只需保证正文归位正确。")
    lines.extend(
        [
            "7. 输出格式必须为：",
            "{",
            '  "title": "根节点标题",',
            '  "children": [',
            "    {",
            '      "text": "节点文字",',
            '      "rich_text_html": "<div>节点文字</div>",',
            '      "emphasis_marks": [],',
            '      "children": []',
            "    }",
            "  ]",
            "}",
            "8. 每个节点即使没有子节点，也必须输出 children: []。",
        ]
    )
    lines.extend(
        [
            "",
            PDF_PAGE_CONTEXT_PROMPT,
            "",
            "下面是已经从结构图中提取出的原始脑图 JSON，请以它为主结构进行增强：",
            json.dumps(structure_tree, ensure_ascii=False),
            "",
        ]
    )
    if page_numbers:
        lines.append(f"本次只允许处理这些 PDF 页面：{format_page_numbers(page_numbers)}。")
    normalized_range_prompt = str(range_prompt or "").strip()
    if normalized_range_prompt:
        lines.append(f"用户补充提示：{normalized_range_prompt}")
    if extracted_text:
        lines.extend(
            [
                "",
                "下面是同一批 PDF 页面抽取出的 OCR 正文，请把它当作正文 grounding，优先根据这些文字补全节点，避免只停留在结构骨架上：",
                truncate_prompt_text(extracted_text),
                "如果 OCR 正文里出现了比结构页更详细的解释、分点或例子，必须把这些新增信息补到对应原始节点下；除非 OCR 正文本身没有新增信息，否则不要只返回原结构骨架。",
                "不要把结构页里已经存在的一级、二级节点原样重抄一遍当作补充结果；你需要继续往下补这些节点对应的正文细节。",
                "如果 OCR 正文已经给出了某个结构节点的下一级或下两级展开，请至少下沉一级后再输出。",
            ]
        )
    lines.extend(
        [
            "",
            "接下来会按顺序提供结构图和正文图片。请综合结构 JSON、OCR 正文和图片内容后输出增强后的完整脑图 JSON。",
        ]
    )
    return "\n".join(lines)


def build_pdf_direct_prompt(
    *,
    range_prompt: str,
    page_numbers: list[int] | None,
    import_options: PdfImportOptions,
    extracted_text: str | None,
) -> str:
    lines = [
        "你是一个严格输出 JSON 的 PDF 转脑图助手。",
        "",
        "任务：",
        "1. 综合用户提供的全部 PDF 页面图片。",
        "2. 直接根据这些页面生成最终脑图，不要假设存在单独的结构页。",
        "3. 只基于本次给出的页面内容输出结果，不要补充页面之外的知识。",
        "",
        "强制要求：",
        "1. 只输出 JSON，不要输出 markdown，不要输出解释。",
        "2. 顶层 JSON 格式必须为：",
        "{",
        '  "title": "根节点标题",',
        '  "children": [',
        "    {",
        '      "text": "节点文字",',
        '      "rich_text_html": "<div>节点文字</div>",',
        '      "emphasis_marks": [],',
        '      "children": []',
        "    }",
        "  ]",
        "}",
        "3. 每个节点即使没有子节点，也必须输出 children: []。",
        "4. 章节主干、层级和顺序要尽量贴合页面原文与版面逻辑。",
    ]
    if import_options.quote_original_text_only:
        lines.append("5. 节点内容默认尽量使用原文，不要随意改写；仅在明显不适合脑图展示时做最小压缩。")
    else:
        lines.append("5. 允许把原文适度压缩成更适合脑图展示的短语，但必须忠实原意，不能捏造。")
    if import_options.semantic_split_long_paragraphs:
        lines.append("6. 遇到长段正文时，按语义拆成多个并列知识点，避免把整段塞进单个节点。")
    else:
        lines.append("6. 不要主动拆分长段正文，除非原文本身就是明显列举关系。")
    if import_options.preserve_emphasis_marks:
        lines.append("7. 如果页面里存在下划线或波浪线强调，尽量在 rich_text_html 和 emphasis_marks 中保留。")
    else:
        lines.append("7. 无需额外保留下划线或波浪线强调，只要内容归位正确即可。")
    if extracted_text:
        lines.extend(
            [
                "",
                "下面是同一批 PDF 页面抽取出的 OCR 正文，请把它当作正文 grounding，优先根据这些文字补全脑图，不能只停留在脑图页自身的结构骨架：",
                truncate_prompt_text(extracted_text),
                "如果 OCR 正文里出现了比页面脑图更详细的解释、分点、例子或并列知识点，必须把这些新增信息补进最终脑图结果。",
                "不要只复述第一页或某一页里现成的脑图主干；必须综合所有选中页面的正文信息生成完整结果。",
                "如果页面里同时出现脑图结构和正文说明，应优先保留清晰的原有层级，再把正文细节继续下沉到对应节点下。",
            ]
        )
    return extend_prompt_for_pdf("\n".join(lines), page_numbers=page_numbers, range_prompt=range_prompt)


def truncate_prompt_text(text: str, limit: int = PROMPT_TEXT_MAX_CHARS) -> str:
    normalized = str(text or "").strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}\n\n[后续 OCR 文本已截断]"


def format_page_numbers(page_numbers: list[int] | None) -> str:
    if not page_numbers:
        return ""
    return "、".join(str(page) for page in page_numbers)


def extend_prompt_for_pdf(prompt: str, *, page_numbers: list[int] | None, range_prompt: str) -> str:
    next_prompt = prompt
    if page_numbers:
        next_prompt += (
            f"\n\n{PDF_PAGE_CONTEXT_PROMPT}\n"
            f"本次只允许处理这些 PDF 页面：{format_page_numbers(page_numbers)}。"
        )
    normalized_range_prompt = str(range_prompt or "").strip()
    if normalized_range_prompt:
        next_prompt += f"\n用户补充提示：{normalized_range_prompt}"
    return next_prompt
