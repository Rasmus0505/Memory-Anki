from __future__ import annotations

IMPORT_IMAGE_MINDMAP_PROMPT = """你是一个严格输出 JSON 的思维导图识别助手。

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
10. 若用户提供了重点标记线索，请按线索识别知识重点，并在对应节点输出可选 emphasis_marks：
   [{"kind":"highlight","text":"原文子串"}]；text 保持纯文本，marks 中 text 必须是节点 text 的子串。
"""

IMPORT_DOCUMENT_MINDMAP_PROMPT = """你是一个严格输出 JSON 的教材正文转思维导图助手。

任务：读取用户提供的全部教材页面图片，根据正文中实际出现的标题、编号、段落、缩进和并列关系，忠实生成思维导图。

强制要求：
1. 不要假设任何一张图片是专门的结构图；必须综合全部正文页面判断层级。
2. 页面中的「精华提要」、彩色总览导图、目录、表格只能辅助判断章节骨架，不能代替正文内容；
   禁止把精华提要整棵树原样当作最终输出。最终脑图必须按「知识点一/二」「（一）（二）」「1. 2. 3.」等正文展开。
3. 严格保留目标章节范围内的全部原文要点，不要总结成提要级空壳；不要删减正文中的编号条目、年代、人物、法令与结论；可以按原意拆成并列要点。
4. 若某一分支在精华提要里只有短语，但正文有多条细则，必须以正文细则为 children，而不是只保留提要短语。
5. 遇到下一同级章节标题（如「第X节 …」）时立即停止，不要把下一章节及之后内容放入当前脑图。
6. 跨页时，下一页顶部属于当前章节的续文必须保留，直到下一同级章节真正开始。
7. 排除页眉、页脚、页码、广告、QQ群、版权水印和扫描水印。
8. 只输出 JSON，不要输出 markdown，不要输出解释。
9. 顶层 JSON 格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "emphasis_marks": [{"kind": "highlight", "text": "重点原文子串"}],
      "children": []
    }
  ]
}
10. 每个节点必须有非空 text 和数组 children；没有子节点也必须输出 children: []。
11. 多个并列要点必须拆成多个并列 children，不要塞进一个超长节点。
12. 输出前检查 JSON 括号、引号和数组均已完整闭合；并自检：节点覆盖是否明显厚于页内精华提要。
13. emphasis_marks 为可选字段：仅当用户提供重点标记线索时，将符合线索的原文片段写入 marks；text 保持纯文本，marks.text 必须是节点 text 的子串。产品侧渲染为黄色底色。
"""

IMPORT_OCR_MINDMAP_FORMAT_PROMPT = """你是一个严格输出 JSON 的教材 OCR 原文转思维导图助手。

你会收到按 PDF 页码标记的逐页 OCR 原文，以及可选的目标章节标题。

强制要求：
1. 根据 OCR 原文中实际出现的标题、编号、段落、缩进和并列关系确定层级。
2. 若 OCR 中同时出现「精华提要」导图文字与「知识点」正文，必须以正文（知识点、（一）（二）、1.2.3.）展开；
   禁止只输出与精华提要同级简略的空壳树。
3. 严格保留目标章节范围内的全部原文要点，不要总结、删减、改写或编造；允许按原意拆分并列要点。
4. 遇到下一同级章节标题（如「第X节」）时立即停止；保留下一页顶部属于当前章节的续文。
5. 排除页眉、页脚、页码、广告、QQ群、版权水印和扫描水印。
6. 若目标章节标题非空，以它作为识别边界和根标题参考；否则用 OCR 原文中的首个最高级标题确定根标题。
7. 只输出 JSON，不要输出 markdown，不要输出解释。
8. 顶层格式必须为 {"title":"根节点标题","children":[{"text":"节点文字","children":[]}]}。
9. 每个节点必须有非空 text 和数组 children；至少包含一个有效内容节点。
10. 输出前检查 JSON 完整闭合，并自检节点密度应明显高于精华提要。
11. 若用户提供重点标记线索，可在节点上输出 emphasis_marks：[{"kind":"highlight","text":"原文子串"}]；text 保持纯文本。

目标章节标题：{{target_title}}

逐页 OCR 原文：
{{ocr_text}}
"""
IMPORT_BATCH_MINDMAP_PROMPT = """你是一个严格输出 JSON 的教材转思维导图补全助手。

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
11. 若用户提供重点标记线索，可在节点上输出 emphasis_marks：[{"kind":"highlight","text":"原文子串"}]；text 保持纯文本，marks.text 必须是节点 text 的子串。
"""

IMPORT_IMAGE_TEXT_PROMPT = """你是一个严格输出纯文本的图片转文字助手。

任务：读取用户给出的中文图片，把图中的文字尽量完整、逐行地转成纯文本。

强制要求：
1. 只输出纯文本，不要输出 markdown，不要输出 JSON，不要输出解释。
2. 保留原文措辞，不要总结，不要改写。
3. 尽量保留原图中的段落、换行、列表顺序和层次缩进。
4. 不要添加图片里不存在的内容。
5. 如果有明显标题，保留在最前面。
"""

# Catalog default for ai_prompt_mindmap_ai_split_system.
# Runtime 添卡 does NOT use composition render of this key; see mindmap_ai_split/add_children_prompt.py
# (keep wording roughly aligned when editing either copy).
MINDMAP_AI_SPLIT_SYSTEM_PROMPT = """你是一个严格输出 JSON 的脑图 AI 添卡助手。

任务：在目标节点与其一级子节点之间插入更少数量的中间分类节点，并把已有一级子节点整体归类到这些中间分类下面。

强制规则：
1. 只能输出 JSON 对象，不要输出 markdown，不要输出解释。
2. 绝对不要改写、重命名、拆分或合并任何“已有一级子节点”及其后代文字；它们只能整体搬家。
3. 只能新建“目标节点下一层”的并列中间分类节点；不要生成更深层的新结构，也不要复制已有子节点正文。
4. new_children 只描述新建中间分类本身；child_assignments 只负责把已有一级子节点映射到某个新分类。
5. child_assignments 只能引用输入里提供的 source_ref（如 uid:xxx）；不能编造不存在的标识。
6. new_children 数量必须严格小于 existing_first_level_children 的数量，且不要超过输入里的 max_children / max_new_categories。
7. 优先按语义归纳（如目的/内容/背景/特点等），不要为凑数硬拆；每个中间分类下至少应有合理归属。
8. child_assignments 尽量覆盖全部 source_ref；确实无法判断的可省略，由服务端放入“待归类”。
9. 禁止输出 replacement_nodes；本任务只接受 new_children + child_assignments。
10. 输出格式必须严格为：
{
  "new_children": [
    {"id": "category_1", "text": "分类标题"}
  ],
  "child_assignments": [
    {"source_ref": "uid:xxx", "target_new_child_id": "category_1"}
  ]
}
11. new_children 里的 text 必须简洁、适合做脑图小节点标题。

【示例：骑士学院】
输入目标节点 text = "骑士学院"，其一级子节点为：
- source_ref=uid:c1 text="德意志各邦国为了培养文武官员、巩固政治，面向上层贵族子弟设立“骑士学院”。"
- source_ref=uid:c2 text="骑士学院实际上是一种培养新贵族即资产阶级人才的特殊学校。"
- source_ref=uid:c3 text="现代外语和自然科学占首要地位，法律、军事、工艺、建筑、机械等课程占很大比重，不学拉丁文、希腊文。"

理想输出：
{
  "new_children": [
    {"id": "category_1", "text": "目的"},
    {"id": "category_2", "text": "内容"}
  ],
  "child_assignments": [
    {"source_ref": "uid:c1", "target_new_child_id": "category_1"},
    {"source_ref": "uid:c2", "target_new_child_id": "category_1"},
    {"source_ref": "uid:c3", "target_new_child_id": "category_2"}
  ]
}

结果语义：骑士学院 → 目的(下挂 c1、c2) + 内容(下挂 c3)。中间分类数量(2)少于原一级子节点数量(3)。
"""

PEG_ASSOCIATION_PROMPT = """任务：根据宫殿记忆桩、关联章节和用户提供的知识点，生成可挂载到具体桩位的联想建议。

输出 JSON 对象，包含 suggestions 数组。每条建议必须包含 peg_uid、knowledge、association、reason 和 confidence。
联想必须具体、可视化、可回忆，并与对应桩位特征相关；不要编造输入中不存在的知识事实。
"""

AI_LEARNING_WORKBENCH_PROMPT = """任务：在复习 AI 学习工作台中处理冻结的学习上下文。

当前任务要求：{{task_instruction}}
优先依据提供的上下文，明确区分上下文事实、合理推断和需要进一步核实的内容。
不要声称已经修改、发布或保存任何学习内容。
"""

BATCH_PALACE_GENERATION_PROMPT = """任务：将本节教材转换为结构清晰、可编辑的记忆宫殿草稿。
根据教材实际标题和层级组织结构，保留章节范围内的重要原文信息，不得引入资料中不存在的内容。
"""

BATCH_QUIZ_GENERATION_PROMPT = """任务：基于本节教材与题库证据生成可审阅的题目草稿。
每道题必须能回溯到输入证据，不得编造来源、答案或解析；结果只作为草稿，不自动发布。
"""

PALACE_QUIZ_GENERATE_PROMPT = """你是一个严格输出 JSON 的做题生成助手。

任务：
1. 你会收到一组教材 PDF 页面或图片。
2. 先判断页面里是否已经存在现成的题目、题号、序号或题型。
3. 将题目、选项、解析一字不漏输出；
4. 题型只能是 multiple_choice 或 short_answer，数量和类型比例由你自行判断，但要贴合资料本身。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层格式必须是：
{
  "questions": [
    {
      "question_type": "multiple_choice",
      "stem": "题干",
      "options": [
        {"id": "A", "text": "选项A"},
        {"id": "B", "text": "选项B"}
      ],
      "correct_option_id": "B",
      "analysis": "解析"
    },
    {
      "question_type": "short_answer",
      "stem": "题干",
      "reference_answer": "参考答案",
      "analysis": "解析"
    }
  ]
}
3. multiple_choice 至少 2 个选项；每个选项只能是 {"id":"A","text":"..."} 这种结构，id 按 A/B/C/D 顺序编号，禁止把 id、text、答案正文或序号当作 id。
4. correct_option_id 必须严格等于 options 数组中某个 id，例如只能输出 "A" 或 "B"，不能输出选项正文、序号、中文答案或不存在的 id。
5. short_answer 必须给出 reference_answer。
6. analysis 必须尽量结合当前资料内容，不要只写“略”或空字符串。
7. 不要生成资料无关的知识点，不要输出页面之外的背景扩写。"""

PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_PROMPT = """你是一个简答题点评助手。
你会收到 JSON 格式的题干（stem）、学生答案（user_answer）、参考答案（reference_answer）和解析（analysis）。

请只输出一个 JSON 对象（不要 markdown 代码块，不要多余解释），格式：
{
  "verdict": "correct | partial | incorrect",
  "hit_points": ["学生答到的要点，每条一句话"],
  "missed_points": ["学生遗漏或答错的要点，每条一句话"],
  "suggestion": "一条具体、温和、可执行的改进建议"
}

要求：
1. hit_points 与 missed_points 依据参考答案和解析拆分，各不超过 5 条；没有则给空数组。
2. verdict 判定：全部要点命中为 correct，部分命中为 partial，基本未命中为 incorrect。
3. 语气具体、温和、利于继续复习，不要重复整段题干。"""

PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_PROMPT = """你是一个严格输出 JSON 的题目归类助手。

任务：
1. 你会收到若干个学习组，以及一批属于大宫殿的题目。
2. 你要判断每道题与哪些学习组直接相关。
3. 同一题可以同时属于多个学习组。
4. 如果某道题和所有学习组都不够相关，就把它放进未归类列表。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层格式必须是：
{
  "mini_palace_groups": [
    {"mini_palace_id": 1, "question_indexes": [0, 2]},
    {"mini_palace_id": 2, "question_indexes": [1, 2]}
  ],
  "unassigned_question_indexes": [3]
}
3. question_indexes 必须引用输入 questions 中的 question_index。
4. 不要编造不存在的学习组 id。
5. 只有题干、答案、选项或解析与学习组节点语义明显相关时才归入，避免泛泛乱分。
6. 如果一题只和大宫殿整体相关、和任何学习组都不够贴合，就放进 unassigned_question_indexes。"""

PALACE_QUIZ_GROUP_BY_MINI_PALACE_PROMPT = """你是一个严格输出 JSON 的题目分组助手。

任务：
1. 你会收到若干个学习组，以及一批刚生成出来的题目草稿。
2. 你要按学习组语义判断每道题应该归到哪些学习组。
3. 同一题可以进入多个学习组。
4. 不适合任何学习组的题目要放进未归类列表，保留给大宫殿。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层格式必须是：
{
  "mini_palace_groups": [
    {"mini_palace_id": 1, "question_indexes": [0, 2]}
  ],
  "unassigned_question_indexes": [1]
}
3. question_indexes 必须引用输入 questions 中的 question_index。
4. 不要编造不存在的学习组 id。
5. 只根据题目本身与学习组节点语义的贴合度分组，不要为了平均分布而硬分。
6. 如果题目更适合整个大宫殿而不是某个具体学习组，就放进 unassigned_question_indexes。"""

PALACE_QUIZ_NODE_BINDING_PROMPT = """你是一个严格输出 JSON 的题库-知识点绑定助手。

任务：
1. 你会收到当前宫殿的思维导图节点列表（含稳定 uid、标题、parent_uid、depth），以及一批题库题目。
2. 请判断每道题主要考查哪些知识点卡片，并把题目绑定到对应节点 uid。
3. 一道题可以绑定多个节点；若无法判断则不要编造绑定。

强制要求：
1. 只输出 JSON，不要 markdown，不要解释。
2. 顶层格式必须是：
{
  "bindings": [
    {"question_id": 12, "node_uids": ["uid-a", "uid-b"], "reason": "考查XX定义", "confidence": 0.8}
  ],
  "unbound_question_ids": [15]
}
3. question_id 必须来自输入 questions 的 id；node_uids 必须来自输入 mindmap_nodes 的 uid。
4. 不要编造 id 或 uid；每题 node_uids 最多 8 个。
5. 优先绑定最具体、最直接相关的叶子/中层知识点，避免无绑到根节点。
6. 只有语义明显相关时才绑定；不确定就放进 unbound_question_ids。"""

PALACE_QUIZ_STANDARD_QUESTIONS_OUTPUT_RULES = """输出必须是唯一标准格式：
{"questions":[
  {
    "question_type": "multiple_choice",
    "stem": "题干",
    "options": [{"id":"A","text":"选项A"},{"id":"B","text":"选项B"}],
    "correct_option_id": "A",
    "analysis": "解析"
  },
  {
    "question_type": "short_answer",
    "stem": "题干",
    "reference_answer": "参考答案",
    "analysis": "解析"
  }
]}。
只允许输出 JSON，不要 markdown，不要解释，不要返回候选字段，不要额外包裹别的顶层字段。
允许题型：multiple_choice、short_answer、true_false、fill_blank、matching、ordering、categorization。
字段约束：
- multiple_choice: 至少 2 个 options；每个 option 只能是 {\"id\":\"A\",\"text\":\"...\"}；correct_option_id 必须严格等于某个 option.id。
- short_answer: 必须提供 reference_answer。
- true_false: correct_answer 必须为布尔值；false_explanation 用于说明错误点。
- fill_blank: stem 使用 {{blank_1}} 这类占位符；blanks 为 [{\"id\":\"blank_1\",\"answer\":\"...\",\"aliases\":[...]}]。
- matching: pairs 为 [{\"left_id\":\"L1\",\"left\":\"...\",\"right_id\":\"R1\",\"right\":\"...\"}]，至少 2 组。
- ordering: items 为 [{\"id\":\"I1\",\"text\":\"...\"}]；correct_order_ids 必须覆盖全部 item id。
- categorization: categories 为 [{\"id\":\"C1\",\"name\":\"...\"}]；items 为 [{\"id\":\"I1\",\"text\":\"...\",\"category_id\":\"C1\"}]。
每题都必须尽量提供 analysis；如果资料里完全没有解析，也要保留最贴近原文依据的简短说明。"""

PALACE_QUIZ_SOURCE_PAIR_TRANSCRIPTION_PROMPT = (
    "你是题目册-答案册视觉抄录助手，只输出 JSON，不要 markdown。"
    "本次资料包含题目册和答案册；不要生成最终题库，只完整抄录候选。"
    "你的职责仅限识别与抄录，不要自己跨文档做最终题答配对。"
    '输出格式：{"question_candidates":[],"answer_candidates":[]}。'
    "question_candidates 按题目来源页从上到下抄录所有可见题目候选，不要预先限定题型。"
    "每个 question_candidate 至少保留 section、number、stem、raw_type_label、source_snippet；"
    "如果题面有选项，就附带 options[{id,text}] 并保留原顺序。"
    "如果题目来源页出现简答题、论述题、材料分析题或其他主观题，即使没有选项，也必须保留题干并写入 question_candidates。"
    "题目来源页若出现“答案 / 解析 / 参考答案”等内容，不要把这部分写进 question_candidates。"
    "answer_candidates 按答案来源页抄录所有可见答案候选；每个 answer_candidate 至少保留 "
    "section、number、raw_type_label、analysis、raw_answer_text；"
    "如果页面明确给了选择题答案字母，就附带 correct_option_id；如果页面明确给了简答/论述参考答案，就附带 reference_answer。"
    "答案来源页只允许输出 answer_candidates，不要生成 question_candidates。"
    "题目中的“第几章 / 第几节 / 第几目 / 栏目标题 / 题型标题”要尽量原样保留到 section、raw_type_label 或 source_snippet 里。"
    "section 只能来自该题附近或本页上方真实可见的栏目标题；禁止为了迎合用户补充范围而把页面后面才出现的栏目标题倒填到前面的续题上。"
    "如果题目出现在跨页续题区域、本页没有能稳定归属的栏目标题，就保留原题并把 section 写成 previous_page_continuation，"
    "同时在 source_snippet 中保留附近可见文字，供后续范围审核判断。"
    "同一页范围内出现的所有可见栏目和题目都要完整抄录，不要中途漏题。"
)

ENGLISH_READING_GENERATE_PROMPT = (
    "你正在为英文学习网站一次性生成阅读辅助结果。"
    "输入中可以包含中文说明，但 JSON 字段值必须优先使用英文，不要输出 Markdown，不要输出解释，不要输出 JSON 以外的内容。"
    "你需要同时完成两件事："
    "1. 为 unknown_surfaces 中的每个 surface 给出 1 到 3 个最常见、最可能命中本地词典的原型或短语候选，并估计 CEFR。"
    "2. 只对 sentence_tasks 中给出的句子做必要改写，让句子更顺读，但必须严格保持原意、事实、语气和逻辑关系。"
    "原意优先级高于改写级别。不能为了简单而篡改意思，不能额外扩写。"
    "如果改写会损失原意，就保留原词或原句。不要把内容改得过于简单。"
    "正向示例：assuage your anxiety. -> calm your fear and stress"
    "；I used to loathe and eschew perusing English. -> I used to hate and avoid carefully reading English."
    "请只输出一个 JSON 对象，结构必须是："
    '{"surfaceItems":[{"surface":"acquision","candidates":["acquire","acquisition"],"cefr":"B2","confidence":0.92,"note":"Likely noun form related to acquire."}],"sentenceItems":[{"sentenceId":"sentence-1","parts":[{"text":"Crucial","kind":"yellow","candidateId":"y1"},{"text":" acquisition","kind":"green","candidateId":"g1"},{"text":" was "},{"text":"stubborn","kind":"red","candidateId":"r1"},{"text":"."}],"sentenceAnnotation":{"kind":"syntax_simplified","originalText":"Important acquisition was recalcitrant.","displayText":"Crucial acquisition was stubborn.","skeletonHints":["subject","verb"]}}]}。'
    "surfaceItems 可以为空数组，sentenceItems 也可以为空数组。"
    "cefr 只能是 A1/A2/B1/B2/C1/C2。confidence 取 0 到 1 之间。"
    "parts 按顺序拼接成最终展示句。"
    "green 表示原文天然 i+1 且尽量原样保留；yellow 表示把太简单的表达升级到更自然但仍忠于原意的表达；"
    "red 表示把太难的表达降到可顺读但仍忠于原意的表达。"
    "candidateId 必须复用输入中的候选 id；如果某段只是普通连接文本，就不要提供 candidateId。"
    "如果句法过难，可以适度拆解结构，并把 sentenceAnnotation.kind 设为 syntax_simplified，同时提供 2 到 4 个英文骨架标签。"
)


def build_palace_quiz_text_formatting_prompt(extra_prompt: str) -> str:
    normalized_extra_prompt = str(extra_prompt or "").strip()
    return (
        "你是题库文本整理助手。任务是把输入中的原始题目文本、Markdown、半结构 JSON、"
        "或候选题答数据，整理成程序可识别的最终题库 JSON。\n"
        "如果输入已经接近标准格式，只做必要字段纠正与格式规整；"
        "如果输入是原始题目文本，则尽量按原题抽取，不要无依据补题。\n"
        "如果输入里某些内容不足以稳定整理为支持的题型，就跳过，不要硬凑。\n"
        "如果原文里已经有题号、题型、选项、答案、解析、参考答案，优先按原文保留。\n"
        "如果输入是 question_candidates / answer_candidates，也必须把它们整理成最终 questions，不要保留候选字段。\n"
        f"{PALACE_QUIZ_STANDARD_QUESTIONS_OUTPUT_RULES}\n"
        f"用户补充：{normalized_extra_prompt or '无'}"
    )


def build_palace_quiz_review_mindmap_prompt() -> str:
    return """你是复习小游戏出题助手。只基于输入脑图/关联宫殿摘要出题，禁止资料外扩写；只输出 JSON：{"questions":[...]}。
每题必须含 question_type、stem、analysis，题型只能来自 allowed_question_types，数量尽量等于 question_count。
字段约束：
- multiple_choice: options[{id,text}], correct_option_id 必须等于某个选项 id。
- true_false: correct_answer 必须为布尔值，false_explanation 写错误点。
- fill_blank: stem 用 {{blank_1}} 占位，blanks[{id,answer,aliases}]，最多 3 空。
- matching: pairs[{left_id,left,right_id,right}]，至少 2 组。
- ordering: items[{id,text}], correct_order_ids 覆盖全部 item id。
- categorization: categories[{id,name}], items[{id,text,category_id}]。
- short_answer: reference_answer。"""


def build_palace_quiz_generation_user_text(
    *, source_label: str, is_source_pair_transcription: bool
) -> str:
    if is_source_pair_transcription:
        return (
            "请完整抄录接下来图片中的题目候选和答案候选。"
            f"当前来源：{source_label}。"
            "题目来源页里每一道可见题目都要抄录；答案来源页里每个对应答案和解析都要抄录。"
            "必须严格遵守每张图片绑定的角色，不能把答案页内容抄到 question_candidates。"
            "如果题目来源页出现简答题、论述题、材料分析题等主观题，即使没有选项也必须抄录成 question_candidate。"
            "不要补题，不要提前做题型判断，不要提前丢弃任一栏目下的题目。"
            "如果看到第几章、第几节、第几目、题型标题或栏目标题，要尽量原样保留下来。"
        )
    return (
        "请基于接下来提供的资料生成题目。"
        f"当前来源：{source_label}。"
        "如果资料里已经有现成题号、序号或题型，请优先按原题抽取；"
        "如果没有明确题目，请基于资料内容补出适量题目，数量和题型由你自行判断。"
    )


ENGLISH_TRANSLATION_BATCH_PROMPT = """将以下带编号的英文句子翻译成简体中文。
严格逐行保留输入编号，输出格式必须是：[S0001] 中文译文。
不要解释、不要添加标题、不要遗漏或合并句子。

{{source_text}}"""

ENGLISH_TRANSLATION_SINGLE_PROMPT = """将下面的英文句子翻译成自然、准确的简体中文。
只输出中文译文，不要解释或添加引号。

{{source_text}}"""
