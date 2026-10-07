"""Four-dimension attribution must survive the ledger round-trip.

The ledger originally stored only ``session_key`` + ``completion_method``, so
every interval was indistinguishable ("06:44 学习时段") and no total could be
grouped per 学科/章节/单元.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from memory_anki.modules.session.domain.time_ledger import TimeLedgerInterval
from memory_anki.modules.session.domain.time_record_attribution import (
    StudySessionAttribution,
)


def _interval(**metadata) -> TimeLedgerInterval:
    start = datetime.now(UTC) - timedelta(minutes=5)
    return TimeLedgerInterval(
        interval_id="s:1",
        session_id="s",
        started_at=start,
        ended_at=start + timedelta(seconds=90),
        kind="freestyle",
        metadata=metadata,
    )


def test_attribution_survives_normalization():
    interval = _interval(
        subject_id=4,
        subject_name="中国教育史",
        chapter_id=6,
        chapter_name="第一节 民国初年的教育改革",
        unit_label="夸美纽斯宫殿",
        palace_id=12,
        scene="freestyle",
        behavior="flip",
        session_key="dwell:abc",
        completion_method="saved",
    )
    normalized = interval.normalized()
    assert normalized.attribution().display_label() == (
        "中国教育史-第一节 民国初年的教育改革-夸美纽斯宫殿-随心-翻卡"
    )
    # Unrelated metadata must be preserved, not clobbered by attribution.
    assert normalized.metadata["session_key"] == "dwell:abc"
    assert normalized.metadata["completion_method"] == "saved"
    assert normalized.metadata["subject_id"] == 4


def test_legacy_metadata_without_attribution_still_parses():
    legacy = _interval(session_key="dwell:x", completion_method="saved").normalized()
    attribution = legacy.attribution()
    assert attribution.has_target is False
    assert legacy.metadata == {"session_key": "dwell:x", "completion_method": "saved"}


def test_blank_attribution_values_are_dropped():
    normalized = _interval(subject_name="   ", subject_id=0, chapter_id=None).normalized()
    assert "subject_name" not in normalized.metadata
    assert "subject_id" not in normalized.metadata
    assert "chapter_id" not in normalized.metadata


class TestStudySessionAttribution:
    def test_display_label_skips_absent_parts(self):
        assert StudySessionAttribution(palace_id=3, scene="quiz", behavior="quiz").display_label() == (
            "做题-做题"
        )
        assert StudySessionAttribution().display_label() == ""

    def test_falls_back_to_ids_when_names_missing(self):
        label = StudySessionAttribution(subject_id=4, chapter_id=6).display_label()
        assert label == "学科#4-章节#6"

    def test_has_target_requires_a_study_target(self):
        assert StudySessionAttribution(scene="dashboard", behavior="browse").has_target is False
        assert StudySessionAttribution(palace_id=9).has_target is True
        assert StudySessionAttribution(subject_id=4).has_target is True

    def test_metadata_round_trip(self):
        original = StudySessionAttribution(
            subject_id=4,
            subject_name="中国教育史",
            chapter_id=6,
            palace_id=12,
            scene="freestyle",
            behavior="flip",
        )
        restored = StudySessionAttribution.from_metadata(original.as_metadata())
        assert restored == original.normalized()

    def test_unknown_scene_and_behavior_stay_readable(self):
        label = StudySessionAttribution(scene="future", behavior="later").display_label()
        assert label == "future-later"

    def test_negative_ids_are_rejected(self):
        assert StudySessionAttribution(subject_id=-1, palace_id=0).normalized().subject_id is None
