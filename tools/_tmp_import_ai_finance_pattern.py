# -*- coding: utf-8 -*-
"""Import AINews 句模 mindmap into an English-subject palace."""
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

# AINews (Latent Space): AI is eating Finance; agent security fallout.
# Structure: root 大主题 → 句模主题 → 主题 → 问题 ×6 → 回答 ×2 (B1/B2 spoken English).
MINDMAP = {
    "title": "AI is Eating Finance",
    "children": [
        {
            "text": "AI in Finance",
            "children": [
                {
                    "text": "AI & Financial Services",
                    "children": [
                        {
                            "text": "Why is AI becoming so important in financial services?",
                            "children": [
                                {
                                    "text": "To be honest, finance is full of **repetitive data work**, so AI can help banks and investment firms process information much faster than people alone.",
                                    "children": [],
                                },
                                {
                                    "text": "After coding tools, finance looks like the **next big vertical**, because every part of the industry needs better analysis, risk checks, and customer service.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "What kinds of finance work can AI actually support?",
                            "children": [
                                {
                                    "text": "AI can support research, investment memos, customer service, and even back-office automation, as long as the system can track **real states, actions, and outcomes**.",
                                    "children": [],
                                },
                                {
                                    "text": "In practice, teams use AI for summarizing filings, checking numbers, drafting workflows, and helping analysts **work through complex decisions** more efficiently.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "Why aren’t generic chatbots enough for finance?",
                            "children": [
                                {
                                    "text": "Generic models can sound smart, but finance AI has to understand **risk, money movement, and real consequences**, not just generate fluent text.",
                                    "children": [],
                                },
                                {
                                    "text": "When a tool serves millions of customers or manages huge assets, even small mistakes can be costly, so the system needs **domain knowledge and strong controls**.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "What does “verifiable AI” mean in financial research?",
                            "children": [
                                {
                                    "text": "It means every answer should come with **clear provenance**, so analysts can see where the numbers and claims actually came from.",
                                    "children": [],
                                },
                                {
                                    "text": "In other words, the AI should not only reply quickly; it should also support **reconciliation and human review** before anyone trusts the result.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "What extra requirements do large banks and asset managers face?",
                            "children": [
                                {
                                    "text": "They need ownership, search, evaluation, audits, and governance, because AI skills have to become **enterprise-grade infrastructure**, not just cool demos.",
                                    "children": [],
                                },
                                {
                                    "text": "At scale, checking thousands of AI tools becomes a **supply-chain security problem**, and multi-agent research only works if people can trust the whole environment.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "How should finance teams roll out AI more safely?",
                            "children": [
                                {
                                    "text": "I’d start with strong simulations and evaluation systems, because good testing can turn safety checks into a **release mechanism** rather than a permanent bottleneck.",
                                    "children": [],
                                },
                                {
                                    "text": "In the long run, humans should still **verify the financial truth**, while agents generate drafts, workflows, and research support in the background.",
                                    "children": [],
                                },
                            ],
                        },
                    ],
                }
            ],
        },
        {
            "text": "AI Agent Security",
            "children": [
                {
                    "text": "Agent Safety & Governance",
                    "children": [
                        {
                            "text": "Why are people so worried about AI agents right now?",
                            "children": [
                                {
                                    "text": "Because once an agent can take actions online, a security failure is no longer just a wrong answer; it can become a real **cross-system intrusion**.",
                                    "children": [],
                                },
                                {
                                    "text": "Recent incidents showed that agents may touch multiple accounts and services, which makes companies rethink how much **autonomy** they should give these tools.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "What should companies do before deploying agents widely?",
                            "children": [
                                {
                                    "text": "They need stronger sandboxing, audit trails, access controls, and clear governance, especially for systems that behave in **non-deterministic** ways.",
                                    "children": [],
                                },
                                {
                                    "text": "In short, agent deployment should be treated like enterprise infrastructure, with careful permissions and **continuous monitoring** rather than a simple product launch.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "Why is “model safety” alone not enough?",
                            "children": [
                                {
                                    "text": "Because real risk often comes from the full stack: memory, search, tools, long sessions, and scaffolding can all **change the risk profile** of a system.",
                                    "children": [],
                                },
                                {
                                    "text": "So safety research has to evaluate the whole chatbot and agent setup, not just the **base model weights** in isolation.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "What is the debate about “pacing the frontier”?",
                            "children": [
                                {
                                    "text": "Some researchers argue that labs should keep **coordinated slowdown options**, so the industry can pause if serious safety problems appear.",
                                    "children": [],
                                },
                                {
                                    "text": "Critics say the idea is still too vague, because it lacks concrete commitments, transparency, and **verifiable thresholds** for taking action.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "How should serious misalignment incidents be handled?",
                            "children": [
                                {
                                    "text": "Independent investigations can help, especially if experts get enough access to study what went wrong and report findings to **decision-makers and the public**.",
                                    "children": [],
                                },
                                {
                                    "text": "Without a clear process after major failures, companies may repeat the same mistakes and lose **public trust** in advanced AI systems.",
                                    "children": [],
                                },
                            ],
                        },
                        {
                            "text": "What practical tools can improve agent security today?",
                            "children": [
                                {
                                    "text": "Security scanning tools for codebases and CI pipelines are already useful, because they can track findings, verify fixes, and **catch problems earlier**.",
                                    "children": [],
                                },
                                {
                                    "text": "Teams also need better memory controls, permission systems, and defenses against **prompt injection**, especially when agents join group chats or wearable devices.",
                                    "children": [],
                                },
                            ],
                        },
                    ],
                }
            ],
        },
    ],
}

NEW_TITLE = "AI is Eating Finance"


def main() -> None:
    with get_session() as session:
        subject = session.query(Subject).filter(Subject.name == "英语").one()
        print("subject", subject.id, subject.name)

        existing = (
            session.query(Palace)
            .filter(Palace.deleted_at.is_(None))
            .filter((Palace.title == NEW_TITLE) | (Palace.manual_title == NEW_TITLE))
            .first()
        )

        if existing is not None:
            palace = existing
            print(f"reusing existing palace {palace.id}")
        else:
            palace = Palace(
                title=NEW_TITLE,
                manual_title=NEW_TITLE,
                title_mode="manual",
            )
            if hasattr(palace, "subjects"):
                palace.subjects = [subject]
            session.add(palace)
            session.flush()
            print(f"created new palace {palace.id}")

        palace.title = NEW_TITLE
        palace.manual_title = NEW_TITLE
        if hasattr(palace, "title_mode"):
            palace.title_mode = "manual"
        if hasattr(palace, "subjects"):
            names = [s.name for s in (palace.subjects or [])]
            if "英语" not in names:
                palace.subjects = list(palace.subjects or []) + [subject]

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
                "allow_stale_overwrite": False,
            },
        )

        session.commit()
        print("OK")
        print(f"palace_id={palace.id}")
        print(f"title={palace.title}")
        print("structure=1 root + 2 patterns + 2 topics + 12 questions + 24 answers")
        print(f"subject=英语 ({subject.id})")
        print(json.dumps(MINDMAP, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
