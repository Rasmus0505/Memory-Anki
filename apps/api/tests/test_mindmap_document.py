from memory_anki.modules.mindmap_document.api import normalize_editor_doc


def test_normalize_editor_doc_preserves_legacy_business_uid_rule():
    normalized = normalize_editor_doc(
        {
            "root": {
                "data": {"text": "old"},
                "children": [
                    {
                        "data": {
                            "text": "chapter",
                            "memoryAnkiId": 42,
                            "memoryAnkiNodeType": "chapter",
                        },
                        "children": [],
                    }
                ],
            }
        },
        root_text="subject",
        root_kind="subject",
    )

    assert normalized["schemaVersion"] == 1
    assert normalized["root"]["data"]["uid"] == "subject-root"
    assert normalized["root"]["children"][0]["data"]["uid"] == "chapter-42"


def test_normalize_editor_doc_generates_deterministic_legacy_uids():
    legacy_doc = {
        "root": {
            "data": {"text": "old"},
            "children": [
                {"data": {"text": "duplicate"}, "children": []},
                {"data": {"text": "duplicate"}, "children": []},
            ],
        }
    }

    first = normalize_editor_doc(legacy_doc, root_text="subject", root_kind="subject")
    second = normalize_editor_doc(legacy_doc, root_text="subject", root_kind="subject")

    first_uids = [child["data"]["uid"] for child in first["root"]["children"]]
    second_uids = [child["data"]["uid"] for child in second["root"]["children"]]

    assert first_uids == second_uids
    assert len(set(first_uids)) == 2
    assert all(uid.startswith("node-legacy-") for uid in first_uids)