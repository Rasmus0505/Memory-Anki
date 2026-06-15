import json
import unittest
import urllib.error
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
    def test_parse_dashscope_response_stream_accumulates_sse_delta_chunks(self):
        class FakeResponse:
            def __iter__(self):
                return iter(
                    [
                        b'data: {"choices":[{"delta":{"content":"\xe7\xac\xac\xe4\xb8\x80"}}]}\n',
                        b"\n",
                        b'data: {"choices":[{"delta":{"content":"\xe7\xab\xa0"}}]}\n',
                        b'data: [DONE]\n',
                    ]
                )

            def read(self):
                return b""

        generator = service._parse_dashscope_response_stream(FakeResponse())
        deltas: list[str] = []
        while True:
            try:
                deltas.append(next(generator))
            except StopIteration as stop:
                final_text = stop.value
                break

        self.assertEqual(deltas, ["第一", "章"])
        self.assertEqual(final_text, "第一章")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_strips_code_fence_json(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = (
            '{"choices":[{"message":{"content":"```json\\n{\\"title\\":\\"第一章\\",\\"children\\":[{\\"text\\":\\"第一节\\",\\"children\\":[]}]}\\n```"}}]}'.encode()
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
            '{"choices":[{"message":{"content":"这是识别结果：{\\"title\\":\\"第二章\\",\\"children\\":[{\\"text\\":\\"重点\\",\\"children\\":[]}]} 请查收"}}]}'.encode()
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
        self.assertNotIn("richText", node_data)
        self.assertEqual(
            node_data["text"],
            "东方教育的特点：重伦理教化，重政治秩序，重宗教传统，重社会等级。",
        )

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
        self.assertEqual(node_text, "总述\n1. 教育目标\n2. 教育内容")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_keeps_overlong_parallel_leaf_as_model_returned(self, mock_urlopen):
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
        self.assertEqual(
            top_node["text"],
            "特点：1. 教育具有强烈的等级性。2. 教育内容丰富。3. 教师地位较高。4. 教学方法简单且体罚盛行。",
        )
        self.assertEqual(top_node["children"], [])
        editor_node = result.editor_doc["root"]["children"][0]
        self.assertEqual(editor_node["data"]["text"], top_node["text"])
        self.assertEqual(editor_node["children"], [])

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_keeps_single_verbose_child_as_model_returned(self, mock_urlopen):
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
        self.assertEqual(len(top_node["children"]), 1)
        self.assertEqual(
            [child["text"] for child in top_node["children"]],
            ["特点：重伦理教化，重政治秩序，重宗教传统，重社会等级"],
        )
        editor_node = result.editor_doc["root"]["children"][0]
        self.assertEqual(len(editor_node["children"]), 1)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.urllib.request.urlopen")
    def test_generate_import_preview_keeps_semicolon_series_under_short_parent(self, mock_urlopen):
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
        self.assertEqual(len(top_node["children"]), 1)
        self.assertEqual(
            top_node["children"][0]["text"],
            "教育内容丰富；教育机构繁多；教师地位高；教育具有等级性；教育方法简单，体罚盛行。",
        )

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
            '{"choices":[{"message":{"content":"抱歉，我无法直接输出标准 JSON，但我看到图片里像是章节和小节的层级结构。"}}]}'.encode()
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
    def test_generate_text_preview_preserves_model_text_verbatim(self, mock_urlopen):
        response = MagicMock()
        response.read.return_value = (
            '{"choices":[{"message":{"content":"```\\n第一章\\n第一节\\n```"}}]}'.encode()
        )
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        mock_urlopen.return_value = response

        result = generate_text_preview(
            image_bytes=b"fake-image",
            filename="demo.png",
        )

        self.assertEqual(result.extracted_text, "```\n第一章\n第一节\n```")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_pdf_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_json")
    def test_generate_batch_import_preview_without_structure_uses_direct_generation(
        self,
        mock_call_json,
        mock_call_batch_json,
        mock_call_pdf_json,
    ):
        mock_call_pdf_json.return_value = {
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

        self.assertIsNone(result.structure_image_index)
        self.assertEqual(result.image_count, 3)
        mock_call_json.assert_not_called()
        mock_call_batch_json.assert_not_called()
        mock_call_pdf_json.assert_called_once()

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
                structure_image_index=0,
            )

        self.assertIn("模型返回内容不是有效的脑图 JSON", str(error.exception))

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_pdf_json")
    def test_generate_pdf_import_preview_only_uses_selected_pages_and_structure_first(
        self,
        mock_call_pdf_json,
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
        mock_call_pdf_json.return_value = {
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
        self.assertIsNone(result.structure_page)
        mock_render_selected_pdf_pages.assert_called_once_with(
            document,
            page_numbers=[2, 4, 6],
            kind="preview",
        )
        mock_call_pdf_json.assert_called_once()
        self.assertEqual(
            mock_call_pdf_json.call_args.kwargs["image_items"],
            [
                (b"page-2", "page-2.png"),
                (b"page-4", "page-4.png"),
                (b"page-6", "page-6.png"),
            ],
        )
        self.assertEqual(mock_call_pdf_json.call_args.kwargs["page_numbers"], [2, 4, 6])
        self.assertEqual(mock_call_pdf_json.call_args.kwargs["range_prompt"], "第一节")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_pdf_json")
    def test_generate_pdf_import_preview_allows_apply_even_when_structure_changes(
        self,
        mock_call_pdf_json,
        mock_call_text_with_images,
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
        mock_call_text_with_images.return_value = "第一节\n原节点（变化）\n正文细节"
        mock_call_pdf_json.return_value = {
            "title": "结构",
            "children": [{"text": "原节点（变化）", "children": []}],
        }

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[2, 4],
            structure_page=4,
            range_prompt="第一节",
            fallback_title="未命名宫殿",
            import_options=PdfImportOptions(),
        )

        self.assertEqual(mock_call_pdf_json.call_args.kwargs["disable_rebalance"], False)
        self.assertEqual(result.match_mode, "direct_generation")
        self.assertTrue(result.can_apply)
        self.assertFalse(result.warnings)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_pdf_json")
    def test_generate_pdf_import_preview_ignores_structure_page_outside_selection(
        self,
        mock_call_pdf_json,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=40,
        )
        mock_render_selected_pdf_pages.return_value = [
            (2, b"page-2", "page-2.png"),
            (3, b"page-3", "page-3.png"),
        ]
        mock_call_pdf_json.return_value = {
            "title": "结构",
            "children": [{"text": "节点", "children": []}],
        }

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[2, 3],
            structure_page=4,
            range_prompt="",
            fallback_title="未命名宫殿",
        )

        self.assertEqual(result.selected_pages, [2, 3])
        self.assertIsNone(result.structure_page)

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
            import_options=PdfImportOptions(
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
        self.assertIn("不要为了美化结构自动拆分正文", prompt)
        self.assertIn("OCR 正文", prompt)
        self.assertNotIn("给定结构与结构页明显对不上", prompt)

    def test_build_pdf_direct_prompt_uses_ocr_grounding_to_prevent_bone_only_results(self):
        prompt = service._build_pdf_direct_prompt(
            range_prompt="古罗马",
            page_numbers=[26, 27, 28],
            import_options=PdfImportOptions(),
            extracted_text="第一节 古罗马的教育阶段\n正文细节\n例子",
        )

        self.assertIn("OCR 正文", prompt)
        self.assertIn("不能只停留在脑图页自身的结构骨架", prompt)
        self.assertIn("不要只复述第一页", prompt)
        self.assertIn("短定义和一两行节点不要拆", prompt)
        self.assertNotIn("默认要主动识别并拆开的句型包括", prompt)
        self.assertIn("不要额外生成教材里没有的新总结语", prompt)

    def test_normalize_pdf_source_tree_keeps_dash_relation_as_model_returned(self):
        normalized = service.normalize_pdf_source_tree(
            {
                "title": "修道院教育",
                "children": [{"text": "性质和目的——为主效力", "children": []}],
            }
        )

        top_node = normalized["children"][0]
        self.assertEqual(top_node["text"], "性质和目的——为主效力")
        self.assertEqual(top_node["children"], [])

    def test_normalize_pdf_source_tree_keeps_parallel_items_under_dash_parent(self):
        normalized = service.normalize_pdf_source_tree(
            {
                "title": "教会教育",
                "children": [{"text": "人员构成——内学/外学", "children": []}],
            }
        )

        top_node = normalized["children"][0]
        self.assertEqual(top_node["text"], "人员构成——内学/外学")
        self.assertEqual(top_node["children"], [])

    def test_normalize_pdf_source_tree_keeps_heading_and_semicolon_series(self):
        normalized = service.normalize_pdf_source_tree(
            {
                "title": "中世纪教育",
                "children": [{"text": "教育内容：早期重宗教信仰；后期以七艺为主", "children": []}],
            }
        )

        top_node = normalized["children"][0]
        self.assertEqual(top_node["text"], "教育内容：早期重宗教信仰；后期以七艺为主")
        self.assertEqual(top_node["children"], [])

    def test_normalize_pdf_source_tree_keeps_age_range_and_children_text(self):
        normalized = service.normalize_pdf_source_tree(
            {
                "title": "骑士教育",
                "children": [{"text": "14~21岁：侍从教育；跟随贵族领主学习骑士七技", "children": []}],
            }
        )

        top_node = normalized["children"][0]
        self.assertEqual(top_node["text"], "14~21岁：侍从教育；跟随贵族领主学习骑士七技")
        self.assertEqual(top_node["children"], [])

    def test_normalize_pdf_source_tree_keeps_definition_sentence(self):
        normalized = service.normalize_pdf_source_tree(
            {
                "title": "修道院教育",
                "children": [{"text": "修道院的性质和目的是为主效力", "children": []}],
            }
        )

        top_node = normalized["children"][0]
        self.assertEqual(top_node["text"], "修道院的性质和目的是为主效力")
        self.assertEqual(top_node["children"], [])

    def test_normalize_pdf_source_tree_keeps_include_and_divide_sentences(self):
        include_tree = service.normalize_pdf_source_tree(
            {
                "title": "骑士教育",
                "children": [{"text": "骑士教育包括宗教、道德、文化", "children": []}],
            }
        )
        divide_tree = service.normalize_pdf_source_tree(
            {
                "title": "学校教育",
                "children": [{"text": "学校教育分为初等、中等", "children": []}],
            }
        )

        self.assertEqual(include_tree["children"][0]["text"], "骑士教育包括宗教、道德、文化")
        self.assertEqual(include_tree["children"][0]["children"], [])
        self.assertEqual(divide_tree["children"][0]["text"], "学校教育分为初等、中等")
        self.assertEqual(divide_tree["children"][0]["children"], [])

    def test_trim_pdf_extracted_text_returns_model_text_without_cropping(self):
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

        self.assertEqual(trimmed, extracted_text)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_pdf_json")
    def test_generate_pdf_import_preview_passes_selected_pages_and_range_prompt_to_direct_call(
        self,
        mock_call_pdf_json,
        mock_call_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=40,
        )
        mock_render_selected_pdf_pages.return_value = [
            (4, b"page-4", "page-4.png"),
            (5, b"page-5", "page-5.png"),
        ]
        mock_call_text_with_images.return_value = "第二节 古希腊的教育阶段\n荷马时期\n正文细节"
        mock_call_pdf_json.return_value = {
            "title": "第二节 古希腊的教育阶段",
            "children": [{"text": "荷马时期", "children": [{"text": "非制度化", "children": []}]}],
        }

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[4, 5],
            structure_page=4,
            range_prompt="古希腊",
            fallback_title="未命名宫殿",
            import_options=PdfImportOptions(),
        )

        self.assertEqual(mock_call_pdf_json.call_count, 1)
        self.assertEqual(mock_call_pdf_json.call_args.kwargs["page_numbers"], [4, 5])
        self.assertEqual(mock_call_pdf_json.call_args.kwargs["range_prompt"], "古希腊")
        self.assertEqual(mock_call_pdf_json.call_args.kwargs["extracted_text"], "第二节 古希腊的教育阶段\n荷马时期\n正文细节")
        self.assertEqual(result.source_tree["children"][0]["children"][0]["text"], "非制度化")
        self.assertFalse(result.warnings)
        self.assertTrue(result.ocr_grounding_used)
        self.assertGreater(result.ocr_text_chars or 0, 0)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_pdf_json")
    def test_generate_pdf_import_preview_returns_direct_generation_without_ocr_warning(
        self,
        mock_call_pdf_json,
        mock_call_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=40,
        )
        mock_render_selected_pdf_pages.return_value = [
            (4, b"page-4", "page-4.png"),
            (5, b"page-5", "page-5.png"),
        ]
        mock_call_text_with_images.return_value = "原节点\n正文细节"
        primary_tree = {
            "title": "结构",
            "children": [{"text": "原节点", "children": []}],
        }
        mock_call_pdf_json.return_value = primary_tree

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[4, 5],
            structure_page=4,
            range_prompt="原节点",
            fallback_title="未命名宫殿",
            import_options=PdfImportOptions(),
        )

        self.assertEqual(result.source_tree, primary_tree)
        self.assertFalse(result.warnings)
        self.assertEqual(result.match_mode, "direct_generation")
        self.assertTrue(result.ocr_grounding_used)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_text_with_images")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._call_dashscope_pdf_json")
    def test_generate_pdf_import_preview_direct_generation_warns_when_ocr_fails(
        self,
        mock_call_pdf_json,
        mock_call_text_with_images,
        mock_render_selected_pdf_pages,
    ):
        document = SubjectDocument(
            id=3,
            subject_id=2,
            filename="subjects/2/demo.pdf",
            original_name="demo.pdf",
            mime_type="application/pdf",
            file_size=123,
            page_count=40,
        )
        mock_render_selected_pdf_pages.return_value = [
            (26, b"page-26", "page-26.png"),
            (27, b"page-27", "page-27.png"),
        ]
        mock_call_text_with_images.side_effect = MindMapImportError("模型没有识别出可用文字。")
        mock_call_pdf_json.return_value = {
            "title": "第一节 古罗马的教育阶段",
            "children": [{"text": "共和时期", "children": []}],
        }

        result = generate_pdf_import_preview(
            document=document,
            page_selection=[26, 27],
            structure_page=None,
            range_prompt="古罗马",
            fallback_title="未命名宫殿",
            import_options=PdfImportOptions(),
        )

        self.assertEqual(mock_call_pdf_json.call_args.kwargs["extracted_text"], None)
        self.assertIn("正文补全可信度可能下降", result.warnings[0])
        self.assertFalse(result.ocr_grounding_used)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._stream_call_dashscope_text")
    def test_stream_text_preview_emits_status_delta_and_result(self, mock_stream_text):
        def fake_stream(**_kwargs):
            yield service.build_delta_event(
                text="第一章",
                accumulated_text="第一章",
                channel="text",
            )
            yield service.build_delta_event(
                text="\n第一节",
                accumulated_text="第一章\n第一节",
                channel="text",
            )
            return "第一章\n第一节"

        mock_stream_text.side_effect = fake_stream

        events = list(
            service.stream_text_preview(
                image_bytes=b"fake-image",
                filename="demo.png",
            )
        )

        self.assertEqual(
            [event["event"] for event in events],
            ["status", "status", "delta", "delta", "status", "result"],
        )
        self.assertEqual(events[0]["data"]["phase"], "validating")
        self.assertEqual(events[1]["data"]["phase"], "calling_model")
        self.assertEqual(events[4]["data"]["phase"], "normalizing_text")
        self.assertEqual(events[-1]["data"]["extracted_text"], "第一章\n第一节")

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._stream_call_dashscope_batch_json")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._stream_call_dashscope_json")
    def test_stream_batch_import_preview_emits_expected_phase_order(
        self,
        mock_stream_json,
        mock_stream_batch_json,
    ):
        def fake_structure_stream(**_kwargs):
            yield service.build_delta_event(
                text='{"title":"第一章"',
                accumulated_text='{"title":"第一章"',
                channel="raw_model",
            )
            return {
                "title": "第一章",
                "children": [{"text": "总论", "children": []}],
            }

        def fake_batch_stream(**_kwargs):
            yield service.build_delta_event(
                text='{"children":[{"text":"总论"}]}',
                accumulated_text='{"title":"第一章","children":[{"text":"总论"}]}',
                channel="raw_model",
            )
            return {
                "title": "第一章",
                "children": [{"text": "总论", "children": [{"text": "补充", "children": []}]}],
            }

        mock_stream_json.side_effect = fake_structure_stream
        mock_stream_batch_json.side_effect = fake_batch_stream

        events = list(
            service.stream_batch_import_preview(
                image_items=[
                    (b"struct", "structure.png"),
                    (b"body", "body.png"),
                ],
                fallback_title="未命名宫殿",
                structure_image_index=0,
            )
        )

        self.assertEqual(
            [event["data"]["phase"] for event in events if event["event"] == "status"],
            ["validating_images", "extracting_structure", "enhancing_with_body", "building_preview"],
        )
        self.assertEqual(events[-1]["event"], "result")
        self.assertEqual(events[-1]["data"]["source_tree"]["title"], "第一章")
        self.assertEqual(events[-1]["data"]["image_count"], 2)

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service.render_selected_pdf_pages")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._stream_call_dashscope_text")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._stream_call_dashscope_pdf_json")
    def test_stream_pdf_import_preview_emits_direct_generation_phases(
        self,
        mock_stream_pdf_json,
        mock_stream_text,
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

        def fake_text_stream(**_kwargs):
            if False:
                yield None
            return "原节点\n正文细节"

        mock_stream_text.return_value = fake_text_stream()

        def fake_pdf_stream(**_kwargs):
            yield service.build_delta_event(
                text='{"children":[{"text":"原节点"}]}',
                accumulated_text='{"title":"结构","children":[{"text":"原节点"}]}',
                channel="raw_model",
            )
            return {
                "title": "结构",
                "children": [{"text": "原节点", "children": []}],
            }

        mock_stream_pdf_json.side_effect = fake_pdf_stream

        events = list(
            service.stream_pdf_import_preview(
                document=document,
                page_selection=[4, 5],
                structure_page=4,
                range_prompt="原节点",
                fallback_title="未命名宫殿",
                import_options=PdfImportOptions(),
            )
        )

        self.assertEqual(
            [event["data"]["phase"] for event in events if event["event"] == "status"],
            [
                "rendering_pages",
                "ocr",
                "generating_mindmap",
                "building_preview",
            ],
        )
        self.assertEqual(events[-1]["event"], "result")
        self.assertFalse(events[-1]["data"]["warnings"])

    @patch("memory_anki.modules.palaces.application.mindmap_import_service.DASHSCOPE_API_KEY", "test-key")
    @patch("memory_anki.modules.palaces.application.mindmap_import_service._stream_call_dashscope_json")
    def test_stream_import_preview_emits_error_event_on_upstream_failure(self, mock_stream_json):
        mock_stream_json.side_effect = MindMapImportError("模型返回内容格式异常。")

        events = list(
            service.stream_import_preview(
                image_bytes=b"fake-image",
                filename="demo.png",
                fallback_title="未命名宫殿",
            )
        )

        self.assertEqual(events[-1], {"event": "error", "data": {"error": "模型返回内容格式异常。"}})


if __name__ == "__main__":
    unittest.main()
