import unittest

from memory_anki.modules.mindmap.application.editor_state_service import _plain_text


class EditorStateServiceTests(unittest.TestCase):
    def test_plain_text_preserves_block_line_breaks_without_truncation(self):
        value = "<div>第一行</div><div>第二行</div><div>第三行</div>"

        result = _plain_text(value, fallback="新节点")

        self.assertEqual(result, "第一行\n第二行\n第三行")
        self.assertGreater(len(result), 8)


if __name__ == "__main__":
    unittest.main()
