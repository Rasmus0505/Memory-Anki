# 题库文本修复

修复题目解析、选项、宫殿脑图里的 OCR / 字体编码残渣。口径与这次修了哪些题见
[docs/题库文本乱码修复.md](../../docs/题库文本乱码修复.md)。

```bash
# 干跑
python tools/question-repair/repair_text_corruption.py

# 写入（先 checkpoint + 整库备份）
python tools/question-repair/repair_text_corruption.py --apply
```

只做脚本里显式列出的修复，不做猜测式批量替换；重复执行是幂等的。
