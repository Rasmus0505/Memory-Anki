"""Prompt routing for mindmap import no longer uses structure-completion prompts."""


def test_structure_completion_prompt_helpers_removed():
    import memory_anki.modules.produce.application.mindmap_import.runtime as runtime

    assert not hasattr(runtime, "_build_batch_prompt")
    assert not hasattr(runtime, "stream_call_dashscope_batch_json")
