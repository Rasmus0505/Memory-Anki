# 英语阅读缺口闭环

> 已移除。英语保留听力（`/english/listening`、课程页面）和 `english_lookup`。阅读、CEFR、句型和词汇页面均已删除。数据库表保留。本说明为历史归档。

英语阅读拥有不可变的来源/生成文章、带锚点的单词或句子目标、纯英语解释、生成运行以及目标到文章的链接。

## 学习流程

```text
source article -> anchored targets -> English explanation -> generated article -> optional second generation layer
```

- 文章内容在创建后不可变；标题更改不会改变目标偏移。
- 仅当目标的引文与存储的内容范围和校验和完全匹配时，该目标才有效。
- 生成文章最多可达到第二层。第二层文章仍可阅读和解释，但不能生成后代。
- 黄色呈现表示目标至少有一条生成文章链接。CEFR 难度颜色和完成反馈已停用。
- 手动配置中的 CEFR 是唯一的难度输入。阅读行为绝不修改它。

## 边界

- `english_reading` 拥有文章、目标、解释、生成运行和链接的持久化。
- AI 调用使用平台 AI 运行时和设置所有的提示词目录。每次按实体划分的生成都携带所属文章和唯一操作 ID。
- 遗留词汇和英语主题句型上下文保持独立。新的阅读闭环不写入任一上下文。
- 消费方使用 `english_reading.api`；最近文章兼容投影不暴露 ORM 行。
- 无框架依赖的选择边界、队列限制和生成默认值归 `modules/english-reading` 所有，并仅通过其 `public.ts` 导出。
