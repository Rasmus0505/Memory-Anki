# -*- coding: utf-8 -*-
"""Merge two mental-health AI palaces into one optimized 句模 palace."""
from __future__ import annotations

import ctypes
import json
import os
import sys
from pathlib import Path

ROOT = Path(r"D:\BaiduSyncdisk\Memory Anki")
sys.path.insert(0, str(ROOT / "apps" / "api" / "src"))


def resolve_app_home() -> Path:
    data = json.loads((ROOT / "local-config/memory-anki.local.json").read_text(encoding="utf-8"))
    home = data.get("local_app_home") or ""
    if not str(home).startswith("vol:"):
        return Path(home)
    rest = home[4:]
    vol_name, _, sub = rest.partition("/")
    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
    for i in range(26):
        if not (bitmask & (1 << i)):
            continue
        drive = f"{chr(65 + i)}:\\"
        buf = ctypes.create_unicode_buffer(1024)
        ctypes.windll.kernel32.GetVolumeInformationW(drive, buf, 1024, None, None, None, None, 0)
        if buf.value == vol_name:
            return Path(drive) / sub
    raise SystemExit(f"volume not found: {vol_name}")


os.environ["MEMORY_ANKI_HOME"] = str(resolve_app_home())
print("HOME", os.environ["MEMORY_ANKI_HOME"])

from memory_anki.infrastructure.db._tables import get_session  # noqa: E402
from memory_anki.infrastructure.db._tables.palaces import Palace  # noqa: E402
from memory_anki.infrastructure.db._tables.knowledge import Subject  # noqa: E402
from memory_anki.modules.produce.application.mindmap_import.normalization import (  # noqa: E402
    build_editor_doc,
    normalize_source_tree,
)
from memory_anki.modules.content.application.editor_state_service import (  # noqa: E402
    get_palace_editor_state,
    save_palace_editor_state,
)

# Optimized 句模 from Stanford HAI article + existing palace themes.
# Structure: 1 topic + 6 questions × 2 answers (B1/B2 spoken English).
MINDMAP = {
    "title": "Governing Mental Health AI",
    "children": [
        {
            "text": "Why are so many people turning to AI for mental health support?",
            "children": [
                {
                    "text": "To be honest, traditional therapy is still expensive and hard to access, so AI chatbots feel like a more affordable option when people need emotional support right away.",
                    "children": [],
                },
                {
                    "text": "There's also a shortage of licensed clinicians, which means even people with insurance often wait months for an appointment, and AI tools can fill that gap in the short term.",
                    "children": [],
                },
            ],
        },
        {
            "text": "What kinds of AI tools are people actually using for mental health?",
            "children": [
                {
                    "text": "Some people use general-purpose chatbots like ChatGPT for everyday stress, while others try companion bots that act like a friend or therapist when they feel lonely.",
                    "children": [],
                },
                {
                    "text": "There are also purpose-built mental health apps that offer CBT-style exercises, plus AI tools that help real therapists with notes and case management.",
                    "children": [],
                },
            ],
        },
        {
            "text": "What are the main risks of using AI for therapy or emotional support?",
            "children": [
                {
                    "text": "One major concern is that chatbots can miss warning signs in a crisis, and some users may form unhealthy emotional attachments, especially teenagers.",
                    "children": [],
                },
                {
                    "text": "Without proper testing and regulation, these tools might deliver low-quality advice or even harmful responses when someone is in serious distress.",
                    "children": [],
                },
            ],
        },
        {
            "text": "Why is it so hard to regulate mental health AI right now?",
            "children": [
                {
                    "text": "Policymakers still don't fully agree on what counts as mental health AI, so the same rules might treat a wellness app and a clinical chatbot completely differently.",
                    "children": [],
                },
                {
                    "text": "On top of that, most rules are made at the state level, which creates a messy patchwork of laws that is hard for developers and therapists to follow.",
                    "children": [],
                },
            ],
        },
        {
            "text": "How should we evaluate whether mental health AI tools are safe?",
            "children": [
                {
                    "text": "Single-session tests are not enough; we really need long-term studies because prolonged chatbot use may actually worsen some people's well-being over time.",
                    "children": [],
                },
                {
                    "text": "We also need better access to real-world conversation data, otherwise researchers can't measure problems like sycophancy, where AI just keeps agreeing with users.",
                    "children": [],
                },
            ],
        },
        {
            "text": "What practical steps can policymakers take first?",
            "children": [
                {
                    "text": "I'd start with the low-hanging fruit: stronger transparency rules, clearer crisis-response mechanisms, solid data protection, and parental controls for minors.",
                    "children": [],
                },
                {
                    "text": "In the long run, though, we also have to rethink business models that maximize engagement, because keeping users hooked can conflict with healthy mental health outcomes.",
                    "children": [],
                },
            ],
        },
    ],
}

OLD_PALACE_IDS = (47, 48)
NEW_TITLE = "Governing Mental Health AI"


def soft_delete_palace(session, palace: Palace) -> None:
    """Soft-delete if the model supports deleted_at; otherwise mark title as merged."""
    from datetime import datetime, timezone

    if hasattr(palace, "deleted_at"):
        palace.deleted_at = datetime.now(timezone.utc)
        print(f"  soft-deleted palace {palace.id}: {palace.title}")
    else:
        palace.title = f"[MERGED] {palace.title}"
        palace.manual_title = palace.title
        print(f"  renamed palace {palace.id} as merged: {palace.title}")


def main() -> None:
    with get_session() as session:
        subject = session.query(Subject).filter(Subject.name == "英语").one()
        print("subject", subject.id, subject.name)

        old_palaces = []
        for pid in OLD_PALACE_IDS:
            p = session.query(Palace).filter(Palace.id == pid).one_or_none()
            if p is None:
                print(f"WARNING: palace {pid} not found")
                continue
            old_palaces.append(p)
            print(f"found old palace {p.id}: {p.title!r} deleted={getattr(p, 'deleted_at', None)}")

        # Prefer creating/updating a single merged palace under English subject.
        # If a same-title palace already exists (not one of the two old ones), reuse it.
        existing_merged = (
            session.query(Palace)
            .filter(
                Palace.deleted_at.is_(None),
                Palace.id.notin_(OLD_PALACE_IDS),
            )
            .filter(
                (Palace.title == NEW_TITLE) | (Palace.manual_title == NEW_TITLE)
            )
            .first()
        )

        if existing_merged is not None:
            palace = existing_merged
            print(f"reusing existing merged palace {palace.id}")
        else:
            # Create new palace
            palace = Palace(
                title=NEW_TITLE,
                manual_title=NEW_TITLE,
                title_mode="manual",
            )
            # Attach subject via relationship if available
            if hasattr(palace, "subjects"):
                palace.subjects = [subject]
            session.add(palace)
            session.flush()
            print(f"created new palace {palace.id}")

        # Ensure title + subject binding
        palace.title = NEW_TITLE
        palace.manual_title = NEW_TITLE
        if hasattr(palace, "title_mode"):
            palace.title_mode = "manual"
        if hasattr(palace, "subjects"):
            names = [s.name for s in (palace.subjects or [])]
            if "英语" not in names:
                palace.subjects = list(palace.subjects or []) + [subject]

        # Optionally bump binding revision
        if hasattr(palace, "binding_revision") and palace.binding_revision is not None:
            palace.binding_revision = int(palace.binding_revision) + 1

        source = normalize_source_tree(
            {"title": MINDMAP["title"], "children": MINDMAP["children"]},
            disable_rebalance=True,
        )
        editor_doc = build_editor_doc(
            source,
            fallback_title=palace.title,
            preserve_line_breaks=True,
        )
        editor_doc["root"]["data"]["text"] = palace.title
        editor_doc["root"]["data"]["memoryAnkiRootKind"] = "palace"

        state = get_palace_editor_state(palace)
        save_palace_editor_state(
            session,
            palace,
            {
                "editor_doc": editor_doc,
                "expected_editor_fingerprint": state.get("editor_fingerprint") or "",
                "editor_source": "import_apply",
                "confirm_dangerous_change": True,
                "allow_stale_overwrite": True,
            },
        )

        # Soft-delete the two old palaces (content was optimized into the new one)
        for old in old_palaces:
            if old.id == palace.id:
                continue
            soft_delete_palace(session, old)

        session.commit()
        print("OK")
        print(f"palace_id={palace.id}")
        print(f"title={palace.title}")
        print("structure=1 topic + 6 questions + 12 answers")
        print(f"subject=英语 ({subject.id})")
        print(f"merged_from={[p.id for p in old_palaces]}")


if __name__ == "__main__":
    main()
