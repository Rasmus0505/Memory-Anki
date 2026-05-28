import unittest
import urllib.error
import json
from unittest.mock import MagicMock, patch

import memory_anki.modules.palaces.application.mindmap_import_service as service
from memory_anki.infrastructure.db.models import SubjectDocument
from memory_anki.modules.palaces.application.mindmap_import_service import (
    MindMapImportError,
    PdfImportOptions,
    generate_batch_import_preview,
    generate_import_preview,
    generate_pdf_import_preview,
    generate_pdf_text_preview,
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
    def test_generate_import_preview_keeps_long_node_text_in_card_without_note(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "第一章",
                                    "children": [
                                        {
                                            "text": "东方教育的特点：重伦理教化，重政治秩序，重宗教传统，重社会等级。",
                                            "children": [],
                                        }
                                    ],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
            ensure_ascii=False,
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        node_data = result.editor_doc["root"]["children"][0]["data"]
        self.assertNotIn("note", node_data)
        self.assertTrue(node_data["richText"])
        self.assertIn("重伦理教化", node_data["text"])
        self.assertNotIn("note", node_data)
        self.assertIn("重社会等级。", node_data["text"])

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_preserves_model_line_breaks(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "第一章",
                                    "children": [
                                        {
                                            "text": "总述\n1. 教育目标\n2. 教育内容",
                                            "children": [],
                                        }
                                    ],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
            ensure_ascii=False,
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        node_text = result.editor_doc["root"]["children"][0]["data"]["text"]
        self.assertEqual(node_text, "<div>总述<br>1. 教育目标<br>2. 教育内容</div>")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_splits_overlong_parallel_leaf_into_children(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "第一章",
                                    "children": [
                                        {
                                            "text": "特点：1. 教育具有强烈的等级性。2. 教育内容丰富。3. 教师地位较高。4. 教学方法简单且体罚盛行。",
                                            "children": [],
                                        }
                                    ],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
            ensure_ascii=False,
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        top_node = result.source_tree["children"][0]
        self.assertEqual(top_node["text"], "特点")
        self.assertEqual(len(top_node["children"]), 4)
        editor_node = result.editor_doc["root"]["children"][0]
        self.assertIn("特点", editor_node["data"]["text"])
        self.assertEqual(len(editor_node["children"]), 4)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_promotes_single_verbose_child_into_parallel_children(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "第一章",
                                    "children": [
                                        {
                                            "text": "特点",
                                            "children": [
                                                {
                                                    "text": "特点：重伦理教化，重政治秩序，重宗教传统，重社会等级",
                                                    "children": [],
                                                }
                                            ],
                                        }
                                    ],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
            ensure_ascii=False,
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        top_node = result.source_tree["children"][0]
        self.assertEqual(top_node["text"], "特点")
        self.assertEqual(len(top_node["children"]), 4)
        self.assertEqual(
            [child["text"] for child in top_node["children"]],
            ["重伦理教化", "重政治秩序", "重宗教传统", "重社会等级"],
        )
        editor_node = result.editor_doc["root"]["children"][0]
        self.assertEqual(len(editor_node["children"]), 4)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_promotes_semicolon_series_under_short_parent(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "第一章",
                                    "children": [
                                        {
                                            "text": "三好两坏",
                                            "children": [
                                                {
                                                    "text": "教育内容丰富；教育机构繁多；教师地位高；教育具有等级性；教育方法简单，体罚盛行。",
                                                    "children": [],
                                                }
                                            ],
                                        }
                                    ],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
            ensure_ascii=False,
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        top_node = result.source_tree["children"][0]
        self.assertEqual(top_node["text"], "三好两坏")
        self.assertEqual(len(top_node["children"]), 5)
        self.assertEqual(top_node["children"][0]["text"], "教育内容丰富")
        self.assertEqual(top_node["children"][-1]["text"], "教育方法简单，体罚盛行。")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_uses_wider_wrap_before_breaking_line(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "第一章",
                                    "children": [
                                        {
                                            "text": "《圣经》、《密西拿》《革马拉》（两书合为《塔木德》）",
                                            "children": [],
                                        }
                                    ],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
            ensure_ascii=False,
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_import_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

        node_text = result.editor_doc["root"]["children"][0]["data"]["text"]
        self.assertNotIn("<br>", node_text)
        self.assertIn("《塔木德》", node_text)

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

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    def test_generate_batch_import_preview_defaults_to_first_image_as_structure(
        self,
        mock_call_json,
        mock_call_batch_json,
    ):
        mock_call_json.return_value = {
            "title": "第一章",
            "children": [{"text": "总论", "children": []}],
        }
        mock_call_batch_json.return_value = {
            "title": "第一章",
            "children": [{"text": "总论", "children": [{"text": "补充", "children": []}]}],
        }

        result = generate_batch_import_preview(
            image_items=[
                (b"struct", "structure.png"),
                (b"body-1", "body1.png"),
                (b"body-2", "body2.png"),
            ],
            fallback_title="未命名宫殿",
        )

        self.assertEqual(result.structure_image_index, 0)
        self.assertEqual(result.image_count, 3)
        mock_call_json.assert_called_once_with(image_bytes=b"struct", filename="structure.png")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    def test_generate_batch_import_preview_uses_selected_structure_index(
        self,
        mock_call_json,
        mock_call_batch_json,
    ):
        mock_call_json.return_value = {
            "title": "第二章",
            "children": [{"text": "概念", "children": []}],
        }
        mock_call_batch_json.return_value = {
            "title": "第二章",
            "children": [{"text": "概念", "children": [{"text": "补充说明", "children": []}]}],
        }

        result = generate_batch_import_preview(
            image_items=[
                (b"body-1", "body1.png"),
                (b"struct", "structure.png"),
            ],
            fallback_title="未命名宫殿",
            structure_image_index=1,
        )

        self.assertEqual(result.structure_image_index, 1)
        mock_call_json.assert_called_once_with(image_bytes=b"struct", filename="structure.png")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    def test_generate_batch_import_preview_rejects_invalid_structure_index(self):
        with self.assertRaises(MindMapImportError) as error:
            generate_batch_import_preview(
                image_items=[(b"struct", "structure.png")],
                fallback_title="未命名宫殿",
                structure_image_index=3,
            )

        self.assertIn("结构图索引无效", str(error.exception))

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    def test_generate_batch_import_preview_surfaces_batch_failure(
        self,
        mock_call_batch_json,
        mock_call_json,
    ):
        mock_call_json.return_value = {
            "title": "第一章",
            "children": [{"text": "总论", "children": []}],
        }
        mock_call_batch_json.side_effect = MindMapImportError("模型返回内容不是有效的脑图 JSON。")

        with self.assertRaises(MindMapImportError) as error:
            generate_batch_import_preview(
                image_items=[
                    (b"struct", "structure.png"),
                    (b"body", "body.png"),
                ],
                fallback_title="未命名宫殿",
            )

        self.assertIn("模型返回内容不是有效的脑图 JSON", str(error.exception))

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    def test_generate_pdf_import_preview_only_uses_selected_pages_and_structure_first(
        self,
        mock_call_json,
        mock_call_batch_json,
        mock_call_dashscope_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=8,
        )
        mock_render_selected_pdf_pages.return_value = [
            (2, b"page-2", "page-2.png"),
            (4, b"page-4", "page-4.png"),
            (6, b"page-6", "page-6.png"),
        ]
        mock_call_json.return_value = {
            "title": "结构",
            "children": [{"text": "节点", "children": []}],
        }
        mock_call_dashscope_text_with_images.return_value = "无关前文\n第一节\n正文"
        mock_call_batch_json.return_value = {
            "title": "结构",
            "children": [{"text": "节点", "children": [{"text": "补充", "children": []}]}],
        }

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[6, 2, 4],
            structure_page=4,
            range_prompt="第一节",
            fallback_title="未命名宫殿",
        )

        self.assertEqual(result.selected_pages, [2, 4, 6])
        self.assertEqual(result.structure_page, 4)
        mock_render_selected_pdf_pages.assert_called_once_with(
            document,
            page_numbers=[2, 4, 6],
            kind="preview",
        )
        mock_call_json.assert_called_once()
        self.assertEqual(mock_call_json.call_args.kwargs["image_bytes"], b"page-4")
        self.assertIn("第一节", mock_call_json.call_args.kwargs["prompt"])
        self.assertEqual(
            mock_call_batch_json.call_args.kwargs["image_items"],
            [
                (b"page-4", "page-4.png"),
                (b"page-2", "page-2.png"),
                (b"page-6", "page-6.png"),
            ],
        )
        self.assertEqual(
            mock_call_dashscope_text_with_images.call_args.kwargs["image_items"],
            [
                (b"page-2", "page-2.png"),
                (b"page-4", "page-4.png"),
                (b"page-6", "page-6.png"),
            ],
        )
        self.assertEqual(mock_call_batch_json.call_args.kwargs["page_numbers"], [2, 4, 6])
        self.assertEqual(mock_call_batch_json.call_args.kwargs["range_prompt"], "第一节")
        self.assertEqual(mock_call_batch_json.call_args.kwargs["extracted_text"], "第一节\n正文")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    def test_generate_pdf_import_preview_strict_restore_disables_rebalance_and_returns_approximate_preview(
        self,
        mock_call_json,
        mock_call_batch_json,
        mock_call_dashscope_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=8,
        )
        mock_render_selected_pdf_pages.return_value = [
            (2, b"page-2", "page-2.png"),
            (4, b"page-4", "page-4.png"),
        ]
        mock_call_json.return_value = {
            "title": "结构",
            "children": [{"text": "原节点", "children": []}],
        }
        mock_call_dashscope_text_with_images.return_value = "结构\n原节点\n正文"
        mock_call_batch_json.return_value = {
            "title": "结构",
            "children": [{"text": "原节点（变化）", "children": []}],
        }

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[2, 4],
            structure_page=4,
            range_prompt="第一节",
            fallback_title="未命名宫殿",
            import_options=PdfImportOptions(strict_restore=True),
        )

        self.assertEqual(mock_call_json.call_args.kwargs["disable_rebalance"], True)
        self.assertEqual(mock_call_batch_json.call_args.kwargs["strict_restore"], True)
        self.assertEqual(mock_call_batch_json.call_args.kwargs["disable_rebalance"], True)
        self.assertEqual(result.match_mode, "approximate_match")
        self.assertFalse(result.can_apply)
        self.assertTrue(result.warnings)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    def test_generate_pdf_import_preview_rejects_structure_page_outside_selection(self):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=8,
        )

        with self.assertRaises(MindMapImportError) as error:
            generate_pdf_import_preview(
                document=document,
                page_selection=[2, 3],
                structure_page=4,
                range_prompt="",
                fallback_title="未命名宫殿",
            )

        self.assertIn("结构页必须包含在当前选择的页码范围内", str(error.exception))

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    def test_generate_pdf_text_preview_passes_selected_pages_and_range_prompt(
        self,
        mock_call_dashscope_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=8,
        )
        mock_render_selected_pdf_pages.return_value = [
            (1, b"page-1", "page-1.png"),
            (3, b"page-3", "page-3.png"),
        ]
        mock_call_dashscope_text_with_images.return_value = "第一节\n正文"

        result = generate_pdf_text_preview(
            document=document,
            page_selection=[3, 1],
            range_prompt="第一节 东方文明古国的教育",
        )

        self.assertEqual(result.selected_pages, [1, 3])
        mock_render_selected_pdf_pages.assert_called_once_with(
            document,
            page_numbers=[1, 3],
            kind="preview",
        )
        self.assertEqual(
            mock_call_dashscope_text_with_images.call_args.kwargs["image_items"],
            [(b"page-1", "page-1.png"), (b"page-3", "page-3.png")],
        )
        self.assertEqual(mock_call_dashscope_text_with_images.call_args.kwargs["page_numbers"], [1, 3])
        self.assertEqual(
            mock_call_dashscope_text_with_images.call_args.kwargs["range_prompt"],
            "第一节 东方文明古国的教育",
        )

    def test_build_pdf_batch_prompt_respects_import_options(self):
        prompt = service._build_pdf_batch_prompt(
            structure_tree={"title": "结构", "children": [{"text": "节点", "children": []}]},
            range_prompt="古希腊",
            page_numbers=[11, 12],
            strict_restore=True,
            import_options=PdfImportOptions(
                strict_restore=True,
                quote_original_text_only=False,
                mount_on_original_leaf_only=False,
                preserve_emphasis_marks=False,
                semantic_split_long_paragraphs=False,
                preserve_line_breaks=True,
            ),
            extracted_text="第二节 古希腊的教育阶段\n正文",
        )

        self.assertIn("可以挂到最近的相关原始父节点下", prompt)
        self.assertIn("可以提炼成更适合脑图展示的短语", prompt)
        self.assertIn("无需额外保留下划线或波浪线强调", prompt)
        self.assertIn("不要为了美化结构自动把长段正文拆成多个并列 children", prompt)
        self.assertIn("OCR 正文", prompt)

    def test_trim_pdf_extracted_text_prefers_structure_title_or_prompt_anchor(self):
        extracted_text = (
            "知识点五 东方文明古国教育发展的特点\n"
            "……前文省略……\n"
            "第二节 古希腊的教育阶段\n"
            "荷马时期\n"
            "古风时期"
        )

        trimmed = service._trim_pdf_extracted_text(
            extracted_text,
            structure_title="第二节 古希腊的教育阶段",
            range_prompt="古希腊",
        )

        self.assertTrue(trimmed.startswith("第二节 古希腊的教育阶段"))
        self.assertNotIn("东方文明古国教育发展的特点", trimmed)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    def test_generate_pdf_import_preview_uses_trimmed_ocr_grounding_for_multi_page_pdf(
        self,
        mock_call_json,
        mock_call_batch_json,
        mock_call_dashscope_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=8,
        )
        mock_render_selected_pdf_pages.return_value = [
            (4, b"page-4", "page-4.png"),
            (5, b"page-5", "page-5.png"),
        ]
        mock_call_json.return_value = {
            "title": "第二节 古希腊的教育阶段",
            "children": [{"text": "荷马时期", "children": []}],
        }
        mock_call_batch_json.return_value = {
            "title": "第二节 古希腊的教育阶段",
            "children": [{"text": "荷马时期", "children": [{"text": "非制度化", "children": []}]}],
        }
        mock_call_dashscope_text_with_images.return_value = (
            "知识点五 东方文明古国教育发展的特点\n"
            "第二节 古希腊的教育阶段\n"
            "荷马时期\n"
            "非制度化"
        )

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[4, 5],
            structure_page=4,
            range_prompt="古希腊",
            fallback_title="未命名宫殿",
            import_options=PdfImportOptions(strict_restore=True),
        )

        self.assertEqual(mock_call_batch_json.call_count, 1)
        self.assertEqual(
            mock_call_batch_json.call_args.kwargs["extracted_text"],
            "第二节 古希腊的教育阶段\n荷马时期\n非制度化",
        )
        self.assertEqual(result.source_tree["children"][0]["children"][0]["text"], "非制度化")
        self.assertFalse(result.warnings)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    def test_generate_pdf_import_preview_keeps_image_batch_when_ocr_text_unavailable(
        self,
        mock_call_json,
        mock_call_batch_json,
        mock_call_dashscope_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=8,
        )
        mock_render_selected_pdf_pages.return_value = [
            (4, b"page-4", "page-4.png"),
            (5, b"page-5", "page-5.png"),
        ]
        mock_call_json.return_value = {
            "title": "结构",
            "children": [{"text": "原节点", "children": []}],
        }
        primary_tree = {
            "title": "结构",
            "children": [{"text": "原节点", "children": []}],
        }
        mock_call_batch_json.return_value = primary_tree
        mock_call_dashscope_text_with_images.side_effect = MindMapImportError("OCR unavailable")

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[4, 5],
            structure_page=4,
            range_prompt="原节点",
            fallback_title="未命名宫殿",
            import_options=PdfImportOptions(strict_restore=True),
        )

        self.assertEqual(result.source_tree, primary_tree)
        self.assertTrue(result.warnings)
        self.assertIn("未获得稳定的 OCR 正文", result.warnings[0])
        self.assertIsNone(mock_call_batch_json.call_args.kwargs["extracted_text"])


if __name__ == "__main__":
    unittest.main()
