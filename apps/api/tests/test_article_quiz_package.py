"""Portable quiz tests use only the shared in-memory SQLite fixture."""
import json
from copy import deepcopy
from uuid import uuid4

import pytest

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
    PalaceSegment,
)
from memory_anki.modules.quiz.api import (
    export_article_quiz,
    import_article_quiz,
    validate_article_quiz_revision,
    validate_article_quiz_target,
)
from memory_anki.modules.quiz.application.question_contracts import PalaceQuizValidationError


def palace(session, uid="root"):
    row = Palace(title="Article", editor_doc=json.dumps({"root": {"data": {"uid": uid, "text": "Article"}, "children": []}}))
    session.add(row)
    session.flush()
    return row


def question(session, owner, node="root", **kwargs):
    row = PalaceQuizQuestion(palace_id=owner.id, question_type="short_answer", stem="Why?",
                             answer_payload_json='{"reference_answer":"Because."}', **kwargs)
    session.add(row)
    session.flush()
    session.add(PalaceQuizQuestionNodeBinding(palace_id=owner.id, question_id=row.id,
                                            node_uid=node, source="manual", reason="Evidence"))
    session.flush()
    return row


def test_export_is_read_only_stable_and_same_owner_updates_only_uuid(db_session):
    owner = palace(db_session)
    original = question(db_session, owner, attempt_count=8)
    unrelated = question(db_session, owner)
    db_session.commit()
    package = export_article_quiz(db_session, owner.id)
    assert package == export_article_quiz(db_session, owner.id)
    assert not db_session.dirty
    package["questions"] = package["questions"][:1]
    uid = package["questions"][0]["uid"]
    package["bindings"] = [edge for edge in package["bindings"] if edge["question_uid"] == uid]
    package["questions"][0]["stem"] = "Updated?"
    result = import_article_quiz(db_session, owner.id, package, {"root": "root"}, same_owner=True)
    assert result["updated_count"] == 1
    assert result["created_count"] == 0
    assert original.stem == "Updated?"
    assert original.attempt_count == 8
    assert unrelated.stem == "Why?"
    assert db_session.query(PalaceQuizQuestionNodeBinding).count() == 2
    db_session.rollback()
    assert original.stem == "Why?"  # importer did not commit


def test_clone_remaps_nodes_and_identity_preserves_source(db_session):
    source = palace(db_session)
    original = question(db_session, source, attempt_count=4)
    target = palace(db_session, "copy-root")
    package = export_article_quiz(db_session, source.id)
    snapshot = deepcopy(package)
    result = import_article_quiz(db_session, target.id, package, {"root": "copy-root"}, same_owner=False)
    clone = db_session.query(PalaceQuizQuestion).filter_by(palace_id=target.id).one()
    assert clone.id != original.id
    assert clone.attempt_count == 0
    assert clone.stem == original.stem
    assert package == snapshot
    old_uid = package["questions"][0]["uid"]
    assert result["question_uid_map"][old_uid] != old_uid
    assert export_article_quiz(db_session, source.id) == snapshot
    copied = export_article_quiz(db_session, target.id)
    assert copied["questions"][0]["uid"] == result["question_uid_map"][old_uid]
    assert copied["bindings"][0]["node_uid"] == "copy-root"


def test_same_content_with_new_explicit_uuid_does_not_match(db_session):
    owner = palace(db_session)
    question(db_session, owner)
    package = export_article_quiz(db_session, owner.id)
    new_uid = str(uuid4())
    package["questions"][0]["uid"] = new_uid
    package["bindings"][0]["question_uid"] = new_uid
    result = import_article_quiz(db_session, owner.id, package, {"root": "root"}, same_owner=True)
    assert result["created_count"] == 1
    assert db_session.query(PalaceQuizQuestion).count() == 2


@pytest.mark.parametrize("damage", ["unknown_node", "unknown_question", "numeric_id", "unknown_answer", "foreign_metadata", "duplicate_uid", "invalid_metadata"])
def test_invalid_package_rejected_before_mutation(db_session, damage):
    owner = palace(db_session)
    original = question(db_session, owner)
    package = export_article_quiz(db_session, owner.id)
    item = package["questions"][0]
    item["stem"] = "Should not persist"
    if damage == "unknown_node":
        package["bindings"][0]["node_uid"] = "missing"
    elif damage == "unknown_question":
        package["bindings"][0]["question_uid"] = str(uuid4())
    elif damage == "numeric_id":
        item["id"] = original.id
    elif damage == "unknown_answer":
        item["answer_payload"]["unsupported"] = "no silent loss"
    elif damage == "foreign_metadata":
        item["source_meta"] = {"related_palace_ids": [999]}
    elif damage == "duplicate_uid":
        package["questions"].append(deepcopy(item))
    else:
        item["source_meta"] = {"manual_import": "bad"}
    with pytest.raises(PalaceQuizValidationError):
        import_article_quiz(db_session, owner.id, package, {"root": "root"}, same_owner=True)
    assert original.stem == "Why?"
    assert db_session.query(PalaceQuizQuestion).count() == 1
    assert db_session.query(PalaceQuizQuestionNodeBinding).count() == 1


@pytest.mark.parametrize("direction", ["inbound", "outbound"])
def test_external_binding_closure_is_rejected(db_session, direction):
    owner = palace(db_session)
    other = palace(db_session)
    original = question(db_session, owner if direction == "outbound" else other)
    edge = db_session.query(PalaceQuizQuestionNodeBinding).filter_by(question_id=original.id).one()
    edge.palace_id = other.id if direction == "outbound" else owner.id
    db_session.flush()
    with pytest.raises(PalaceQuizValidationError, match="external"):
        export_article_quiz(db_session, owner.id)


def test_replacement_guard_preserves_bound_nodes(db_session):
    owner = palace(db_session)
    question(db_session, owner)
    validate_article_quiz_target(db_session, owner.id, {"root", "added"})
    with pytest.raises(PalaceQuizValidationError, match="removes bound nodes"):
        validate_article_quiz_target(db_session, owner.id, {"replacement"})


def test_foreign_question_relations_rejected_on_export(db_session):
    owner = palace(db_session)
    question(db_session, owner, origin_question_id=123)
    with pytest.raises(PalaceQuizValidationError, match="relations"):
        export_article_quiz(db_session, owner.id)


@pytest.mark.parametrize(("kind", "options", "answer"), [
    ("multiple_choice", [{"id": "A", "text": "One"}, {"id": "B", "text": "Two"}], {"correct_option_id": "A"}),
    ("true_false", [], {"correct_answer": False, "false_explanation": "False."}),
    ("fill_blank", [], {"blanks": [{"id": "b", "answer": "yes", "aliases": []}]}),
    ("matching", [], {"pairs": [{"left_id": "l1", "left": "one", "right_id": "r1", "right": "uno"}, {"left_id": "l2", "left": "two", "right_id": "r2", "right": "dos"}]}),
    ("ordering", [], {"items": [{"id": "a", "text": "one"}, {"id": "b", "text": "two"}], "correct_order_ids": ["b", "a"]}),
    ("categorization", [], {"categories": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}], "items": [{"id": "one", "text": "One", "category_id": "a"}, {"id": "two", "text": "Two", "category_id": "b"}]}),
])
def test_supported_answer_types_round_trip(db_session, kind, options, answer):
    owner = palace(db_session)
    row = question(db_session, owner)
    row.question_type = kind
    row.options_json = json.dumps(options)
    row.answer_payload_json = json.dumps(answer)
    db_session.flush()
    package = export_article_quiz(db_session, owner.id)
    target = palace(db_session)
    import_article_quiz(db_session, target.id, package, {"root": "root"}, same_owner=False)
    exported = export_article_quiz(db_session, target.id)["questions"][0]
    assert exported["options"] == options
    assert exported["answer_payload"] == answer


def test_segment_relations_use_remapped_portable_descriptors(db_session):
    from memory_anki.modules.content.application.article_package_segments import (
        restore_article_package_segments,
    )

    owner = palace(db_session)
    row = question(db_session, owner)
    linked = PalaceSegment(palace_id=owner.id, name="Linked", node_uids_json='["root"]')
    unlinked = PalaceSegment(palace_id=owner.id, name="Unlinked", node_uids_json='["root"]')
    db_session.add_all([linked, unlinked])
    row.segments = [linked]
    db_session.flush()
    package = export_article_quiz(db_session, owner.id)
    assert len(package["segments"]) == 2
    assert len(package["questions"][0]["segments"]) == 1
    target = palace(db_session, "copy")
    mapping = {"root": "copy"}
    with pytest.raises(PalaceQuizValidationError, match="restore content segments"):
        import_article_quiz(db_session, target.id, package, mapping, same_owner=False)
    restore_article_package_segments(db_session, target.id, package["segments"], mapping)
    import_article_quiz(db_session, target.id, package, mapping, same_owner=False)
    clone = db_session.query(PalaceQuizQuestion).filter_by(palace_id=target.id).one()
    assert len(clone.segments) == 1
    assert clone.segments[0].id != linked.id
    assert clone.segments[0].name == "Linked"
    assert clone.segments[0].node_uids_json == '["copy"]'
    assert db_session.query(PalaceSegment).filter_by(palace_id=target.id).count() == 2
    assert row.segments == [linked]


def test_revision_guard_detects_quiz_edit_without_document_change(db_session):
    owner = palace(db_session)
    row = question(db_session, owner)
    package = export_article_quiz(db_session, owner.id)
    package["questions"][0]["stem"] = "Offline edit"
    validate_article_quiz_revision(db_session, owner.id, package)
    row.analysis = "Concurrent edit"
    db_session.flush()
    with pytest.raises(PalaceQuizValidationError, match="changed since export"):
        validate_article_quiz_revision(db_session, owner.id, package)


def test_nested_metadata_and_binding_reason_round_trip(db_session):
    owner = palace(db_session)
    meta = {"manual_import": {"source": "article"}, "page_numbers": [2]}
    question(db_session, owner, source_meta_json=json.dumps(meta))
    target = palace(db_session)
    package = export_article_quiz(db_session, owner.id)
    import_article_quiz(db_session, target.id, package, {"root": "root"}, same_owner=False)
    copied = export_article_quiz(db_session, target.id)
    assert copied["questions"][0]["source_meta"]["manual_import"]["source"] == "article"
    assert copied["questions"][0]["source_meta"]["page_numbers"] == [2]
    assert copied["bindings"][0]["reason"] == "Evidence"
