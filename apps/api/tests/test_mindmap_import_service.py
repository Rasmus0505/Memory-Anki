import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from memory_anki.modules.palaces.application.mindmap_import_service import (
    MindMapImportError,
    generate_import_preview,
    generate_text_preview,
)


class MindMapImportServiceTests(unittest.TestCase):
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_strips_code_fence_json(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = (
            '{"choices":[{"message":{"content":"```json\\n{\\"title\\":\\"第一章\\",\\"children\\":[{\\"text\\":\\"第一节\\",\\"children\\":[]}]}\\n```"}}]}'.encode("utf-8")
        )
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        self.assertEqual(result.source_tree["title"], "第一章")
        self.assertEqual(result.source_tree["children"][0]["text"], "第一节")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_extracts_json_from_wrapped_text(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = (
            '{"choices":[{"message":{"content":"这是识别结果：{\\"title\\":\\"第二章\\",\\"children\\":[{\\"text\\":\\"重点\\",\\"children\\":[]}]} 请查收"}}]}'.encode("utf-8")
        )
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        self.assertEqual(result.source_tree["title"], "第二章")
        self.assertEqual(result.source_tree["children"][0]["text"], "重点")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_includes_short_model_snippet_on_invalid_json(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = (
            '{"choices":[{"message":{"content":"抱歉，我无法直接输出标准 JSON，但我看到图片里像是章节和小节的层级结构。"}}]}'.encode("utf-8")
        )
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        with self.assertRaises(MindMapImportError) as error:
            generate_import_preview(
                image_bytes=b"fake-image",
                filename="demo.png",
                fallback_title="未命名宫殿",
            )

        message = str(error.exception)
        self.assertIn("模型返回内容不是有效的脑图 JSON", message)
        self.assertIn("返回摘要", message)
        self.assertIn("抱歉，我无法直接输出标准 JSON", message)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_surfaces_connection_refused_target_url(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError(
            OSError(10061, "由于目标计算机积极拒绝，无法连接。")
        )

        with self.assertRaises(MindMapImportError) as error:
            generate_import_preview(
                image_bytes=b"fake-image",
                filename="demo.png",
                fallback_title="未命名宫殿",
            )

        message = str(error.exception)
        self.assertIn("连接被拒绝", message)
        self.assertIn("10061", message)
        self.assertIn("DASHSCOPE_BASE_URL", message)
        self.assertIn("/chat/completions", message)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_text_preview_strips_code_fence(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = (
            '{"choices":[{"message":{"content":"```\\n第一章\\n第一节\\n```"}}]}'.encode("utf-8")
        )
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_text_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
        )

        self.assertEqual(result.extracted_text, "第一章\n第一节")


if __name__ == "__main__":
    unittest.main()
