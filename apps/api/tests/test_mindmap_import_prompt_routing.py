from memory_anki.modules.palaces.application.mindmap_import.runtime import _build_batch_prompt


class RecordingPromptCatalog:
    def __init__(self):
        self.calls = []

    def render(self, key, values=None):
        self.calls.append((key, values))
        return key


def test_ordinary_document_uses_direct_document_prompt():
    catalog = RecordingPromptCatalog()
    prompt = _build_batch_prompt(
        prompt_catalog=catalog,
        structure_tree=None,
        range_prompt="",
        page_numbers=None,
        extracted_text=None,
    )

    assert prompt == "ai_prompt_import_document_mindmap"
    assert catalog.calls == [("ai_prompt_import_document_mindmap", None)]


def test_explicit_structure_uses_structure_completion_prompt():
    catalog = RecordingPromptCatalog()
    prompt = _build_batch_prompt(
        prompt_catalog=catalog,
        structure_tree={"title": "德国近代教育", "children": []},
        range_prompt="",
        page_numbers=None,
        extracted_text=None,
    )

    assert prompt == "ai_prompt_import_batch_mindmap"
    assert catalog.calls[0][0] == "ai_prompt_import_batch_mindmap"
    assert "structure_tree_json" in catalog.calls[0][1]