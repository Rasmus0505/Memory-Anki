from __future__ import annotations

ACTIVE_STATUSES = ("active", "paused", "recovered")
STUDY_DASHBOARD_SCENES = (
    "palace_edit",
    "practice",
    "formal_unit_review",
    "freestyle_unit_review",
    "quiz",
    "freestyle",
    "custom",
)
FORMAL_REVIEW_SCENES = ("formal_unit_review",)
ENGLISH_SCENES = ("english",)
ENGLISH_READING_SCENES = ("english_reading",)
CUSTOM_TIME_RECORD_SCENE = "custom"
BUILTIN_TIME_RECORD_KINDS = ("review", "practice", "quiz", "palace_edit")
TIME_RECORD_KIND_LABELS = {
    "review": "正式复习",
    "practice": "练习",
    "quiz": "做题",
    "palace_edit": "宫殿编辑",
    "custom": "其他",
}
