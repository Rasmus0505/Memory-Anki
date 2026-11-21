import json
from copy import deepcopy

import pytest

from memory_anki.modules.content.api import build_tree_from_editor_doc, stable_tree_order
from memory_anki.modules.mindmap_document.api import build_document_tree, normalize_editor_doc


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


@pytest.mark.parametrize("serialized", [False, True])
def test_tree_projections_share_identity_and_order_but_preserve_their_fields(serialized):
    document = {
        "root": {
            "data": {"memoryAnkiId": 7, "text": " root ", "memoryAnkiRootKind": " palace "},
            "children": [
                None,
                {
                    "data": {
                        "uid": " branch ",
                        "memoryAnkiId": 42,
                        "memoryAnkiNodeType": " chapter ",
                        "note": " memo ",
                        "text": " 知识 ",
                        "permanentSplitMark": True,
                        "expand": False,
                        "isActive": True,
                    },
                    "children": [
                        "bad",
                        {"data": {"type": " point ", "permanent_split_mark": True}},
                    ],
                },
                {
                    "data": {
                        "memoryAnkiId": 13,
                        "permanentSplitMark": "true",
                        "permanent_split_mark": 1,
                    }
                },
            ],
        },
    }
    source = json.dumps(document, ensure_ascii=False) if serialized else document
    original = deepcopy(source)
    palace_root, palace = build_tree_from_editor_doc(source)
    doc_root, rich = build_document_tree(source)

    assert source == original
    assert palace_root == doc_root == "7"
    assert list(palace) == list(rich) == ["root-1-1", "branch", "13", "7"]
    assert stable_tree_order(palace, root_uid=palace_root) == ["branch", "root-1-1", "13"]
    assert palace["7"]["children"] == ["branch", "13"]
    assert palace["branch"] == {
        "uid": "branch",
        "parent_uid": "7",
        "children": ["root-1-1"],
        "text": "知识",
        "content_fingerprint": "8e39a588e56cb1bb9ac8da7461abd771523c59681955ca3985ec7fca64c0d32a",
        "permanent_split_mark": True,
    }
    for uid, node in rich.items():
        shared = {
            key: node[key]
            for key in ("uid", "parent_uid", "children", "text", "content_fingerprint")
        }
        marked = uid in {"branch", "root-1-1"}
        if marked:
            shared["permanent_split_mark"] = True
        assert palace[uid] == shared
        assert node["permanent_split_mark"] is marked

    assert rich["7"]["root_kind"] == "palace"
    assert rich["branch"]["note"] == "memo"
    assert rich["branch"]["node_type"] == "chapter"
    assert rich["root-1-1"]["node_type"] == "point"
    assert rich["root-1-1"]["depth"] == 2
    assert rich["root-1-1"]["ancestor_path"] == [
        {"uid": "7", "text": "root"},
        {"uid": "branch", "text": "知识"},
        {"uid": "root-1-1", "text": ""},
    ]


@pytest.mark.parametrize("build_tree", [build_tree_from_editor_doc, build_document_tree])
def test_tree_fingerprint_ignores_editor_state_but_detects_content_changes(build_tree):
    data = {"uid": "root", "text": "original"}
    document = {"root": {"data": data}}

    def fingerprint():
        return build_tree(document)[1]["root"]["content_fingerprint"]

    original = fingerprint()
    data.update(expand=True, isActive=True, permanentSplitMark=False, permanent_split_mark=True)
    assert fingerprint() == original

    data["text"] = "updated"
    assert fingerprint() != original


@pytest.mark.parametrize(
    ("children", "rich_children"),
    [
        (None, []),
        (1, []),
        (True, []),
        ("bad", []),
        ({"data": {}}, []),
        (({"data": {}},), ["root-0"]),
    ],
)
def test_tree_projections_preserve_malformed_child_compatibility(children, rich_children):
    source = {"root": {"data": "bad", "children": children}}
    compact_root, compact_nodes = build_tree_from_editor_doc(source)
    rich_root, rich_nodes = build_document_tree(source)

    assert compact_root == rich_root == "root"
    assert list(compact_nodes) == ["root"]
    assert compact_nodes["root"]["children"] == []
    assert rich_nodes["root"]["children"] == rich_children
    assert list(rich_nodes) == [*rich_children, "root"]
    assert compact_nodes["root"]["text"] == rich_nodes["root"]["text"] == ""


@pytest.mark.parametrize("source", [None, "", "{bad", "null", [], {"root": []}])
def test_tree_projections_return_empty_for_invalid_documents(source):
    assert build_tree_from_editor_doc(source) == (None, {})
    assert build_document_tree(source) == (None, {})
