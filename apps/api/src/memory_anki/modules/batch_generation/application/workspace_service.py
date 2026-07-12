from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from sqlalchemy.orm import Session

from memory_anki.core.config import APP_HOME
from memory_anki.infrastructure.db._tables.batch_generation import (
    BatchGenerationAsset,
    BatchGenerationBook,
    BatchGenerationDraft,
    BatchGenerationPublishPlan,
    BatchGenerationQualityIssue,
    BatchGenerationSection,
    BatchGenerationStep,
    BatchGenerationWorkspace,
)

ASSET_ROOT = APP_HOME / "batch_generation"
TITLE_PATTERN = re.compile(r"^(第[一二三四五六七八九十百零0-9]+[章节篇部]|\d+(?:\.\d+)+)\s*.+")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _load(value: str) -> Any:
    return json.loads(value or "{}")


class BatchWorkspaceService:
    def __init__(self, session: Session):
        self.session = session

    def create_workspace(self, title: str) -> dict[str, Any]:
        workspace = BatchGenerationWorkspace(
            id=str(uuid.uuid4()), title=title.strip() or "整书批量生成", operation_id=str(uuid.uuid4()), settings_json=_json({"quality_policy": "rules_plus_sampling", "budget_mode": "estimate_only"})
        )
        self.session.add(workspace)
        self.session.commit()
        return self.snapshot(workspace.id)

    def add_pdf(self, workspace_id: str, source: Path, role: str) -> dict[str, Any]:
        workspace = self._workspace(workspace_id)
        if role not in {"textbook", "quiz"}:
            raise ValueError("role must be textbook or quiz")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        asset_id = str(uuid.uuid4())
        target_dir = ASSET_ROOT / workspace_id / "assets"
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{asset_id}.pdf"
        shutil.copy2(source, target)
        analysis = self._analyze_pdf(target)
        asset = BatchGenerationAsset(id=asset_id, workspace_id=workspace_id, role=role, original_name=source.name, relative_path=target.relative_to(APP_HOME).as_posix(), sha256=digest, file_size=target.stat().st_size, **analysis)
        self.session.add(asset)
        if role == "textbook":
            book = BatchGenerationBook(id=str(uuid.uuid4()), workspace_id=workspace_id, textbook_asset_id=asset.id, title=source.stem, sort_order=self.session.query(BatchGenerationBook).filter_by(workspace_id=workspace_id).count())
            self.session.add(book)
            self.session.flush()
            self._create_outline(book, asset)
        else:
            candidate = self.session.query(BatchGenerationBook).filter_by(workspace_id=workspace_id, quiz_asset_id=None).order_by(BatchGenerationBook.sort_order).first()
            if candidate:
                candidate.quiz_asset_id = asset.id
        workspace.updated_at = datetime.utcnow()
        self.session.commit()
        return self.snapshot(workspace_id)

    def update_section(self, section_id: str, changes: dict[str, Any], expected_revision: int) -> dict[str, Any]:
        section = self.session.get(BatchGenerationSection, section_id)
        if not section:
            raise KeyError("section not found")
        if section.revision != expected_revision:
            raise RuntimeError("section revision conflict")
        for key in ["title", "start_page", "end_page", "output_mode", "excluded", "existing_chapter_id", "existing_palace_id"]:
            if key in changes:
                setattr(section, key, changes[key])
        if section.start_page < 1 or section.end_page < section.start_page:
            raise ValueError("invalid page range")
        section.revision += 1
        section.operation_id = str(uuid.uuid4())
        section.status = "waiting_confirmation"
        section.updated_at = datetime.utcnow()
        for step in self.session.query(BatchGenerationStep).filter_by(section_id=section.id):
            step.status = "stale"
            step.operation_id = section.operation_id
        self.session.commit()
        return self._section_record(section)

    def confirm_outline(self, book_id: str, representative_section_id: str) -> dict[str, Any]:
        book = self.session.get(BatchGenerationBook, book_id)
        section = self.session.get(BatchGenerationSection, representative_section_id)
        if not book or not section or section.book_id != book.id:
            raise ValueError("invalid representative section")
        book.representative_section_id = section.id
        book.gate_status = "representative_ready"
        section.status = "queued"
        self.session.commit()
        return self.snapshot(book.workspace_id)

    def prompt_preview(self, section_id: str, kind: str, model: str, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        section = self.session.get(BatchGenerationSection, section_id)
        if not section:
            raise KeyError("section not found")
        book = self.session.get(BatchGenerationBook, section.book_id)
        asset = self.session.get(BatchGenerationAsset, book.textbook_asset_id) if book else None
        samples = _load(asset.sample_text_json) if asset else []
        page_text = [item for item in samples if section.start_page <= item.get("page", 0) <= section.end_page]
        payload = {"section": {"title": section.title, "pages": [section.start_page, section.end_page]}, "source_text": page_text, "images": [], "structured_output": "json_object"}
        estimated_input = max(1, (len(system_prompt) + len(user_prompt) + len(_json(payload))) // 2)
        return {"model": model, "system_prompt": system_prompt, "user_prompt": user_prompt, "input": payload, "estimated_input_tokens": estimated_input, "estimated_output_tokens": 3000 if kind == "palace" else 2000, "handoff": {"kind": kind, "palace_url": f"/palaces/{section.existing_palace_id}/edit" if section.existing_palace_id else "/palaces/new", "quiz_url": f"/palaces/{section.existing_palace_id}/quiz" if section.existing_palace_id else None}}

    def save_draft(self, section_id: str, kind: str, content: dict[str, Any], operation_id: str) -> dict[str, Any]:
        section = self.session.get(BatchGenerationSection, section_id)
        if not section:
            raise KeyError("section not found")
        if section.operation_id != operation_id:
            raise RuntimeError("stale operation")
        draft = self.session.query(BatchGenerationDraft).filter_by(section_id=section_id, kind=kind).first()
        if not draft:
            draft = BatchGenerationDraft(id=str(uuid.uuid4()), section_id=section_id, kind=kind)
            self.session.add(draft)
        draft.content_json = _json(content)
        draft.source_revision = section.revision
        draft.updated_at = datetime.utcnow()
        section.status = "review"
        self._quality_check(section, kind, content)
        self.session.commit()
        return self._section_record(section)

    def build_publish_plan(self, workspace_id: str) -> dict[str, Any]:
        self._workspace(workspace_id)
        actions: list[dict[str, Any]] = []
        conflicts: list[dict[str, Any]] = []
        books = self.session.query(BatchGenerationBook).filter_by(workspace_id=workspace_id).all()
        for book in books:
            for section in self.session.query(BatchGenerationSection).filter_by(book_id=book.id, excluded=False).order_by(BatchGenerationSection.sort_order):
                drafts = self.session.query(BatchGenerationDraft).filter_by(section_id=section.id).all()
                issues = self.session.query(BatchGenerationQualityIssue).filter_by(section_id=section.id, resolved=False).all()
                if issues:
                    conflicts.append({"section_id": section.id, "reason": "unresolved_quality_issues", "count": len(issues)})
                for draft in drafts:
                    actions.append({"section_id": section.id, "kind": draft.kind, "mode": "replace" if (draft.kind == "palace" and section.existing_palace_id) else "merge" if draft.kind == "quiz" and section.existing_chapter_id else "create", "requires_confirmation": True})
        plan = BatchGenerationPublishPlan(id=str(uuid.uuid4()), workspace_id=workspace_id, status="blocked" if conflicts else "ready", actions_json=_json(actions), conflicts_json=_json(conflicts))
        self.session.add(plan)
        self.session.commit()
        return {"id": plan.id, "status": plan.status, "actions": actions, "conflicts": conflicts}

    def snapshot(self, workspace_id: str) -> dict[str, Any]:
        workspace = self._workspace(workspace_id)
        assets = self.session.query(BatchGenerationAsset).filter_by(workspace_id=workspace_id).all()
        books = self.session.query(BatchGenerationBook).filter_by(workspace_id=workspace_id).order_by(BatchGenerationBook.sort_order).all()
        return {"id": workspace.id, "title": workspace.title, "status": workspace.status, "operation_id": workspace.operation_id, "settings": _load(workspace.settings_json), "assets": [self._asset_record(item) for item in assets], "books": [{"id": book.id, "title": book.title, "textbook_asset_id": book.textbook_asset_id, "quiz_asset_id": book.quiz_asset_id, "subject_id": book.subject_id, "default_output_mode": book.default_output_mode, "gate_status": book.gate_status, "representative_section_id": book.representative_section_id, "sections": [self._section_record(item) for item in self.session.query(BatchGenerationSection).filter_by(book_id=book.id).order_by(BatchGenerationSection.sort_order)]} for book in books]}

    def _workspace(self, workspace_id: str) -> BatchGenerationWorkspace:
        workspace = self.session.get(BatchGenerationWorkspace, workspace_id)
        if not workspace:
            raise KeyError("workspace not found")
        return workspace

    def _analyze_pdf(self, path: Path) -> dict[str, Any]:
        reader = PdfReader(str(path))
        samples = []
        text_pages = 0
        headings = []
        for index, page in enumerate(reader.pages):
            text = (page.extract_text() or "").strip()
            if len(text) >= 40:
                text_pages += 1
            if index < 40 or index % 10 == 0:
                samples.append({"page": index + 1, "text": text[:3000]})
            for line in text.splitlines()[:15]:
                line = line.strip()
                if TITLE_PATTERN.match(line):
                    headings.append({"title": line[:180], "page": index + 1})
        bookmarks = []
        try:
            def flatten(items: list[Any], level: int = 1) -> None:
                for item in items:
                    if isinstance(item, list):
                        flatten(item, level + 1)
                    else:
                        try:
                            page_number = reader.get_destination_page_number(item)
                            if page_number is None:
                                continue
                            bookmarks.append({"title": str(item.title), "page": page_number + 1, "level": level})
                        except Exception:
                            continue
            flatten(reader.outline)
        except Exception:
            pass
        page_count = len(reader.pages)
        return {"page_count": page_count, "text_page_count": text_pages, "scanned_page_count": page_count - text_pages, "bookmarks_json": _json(bookmarks), "sample_text_json": _json(samples), "analysis_json": _json({"pdf_profile": "text" if text_pages == page_count else "scan" if text_pages == 0 else "mixed", "heading_candidates": headings[:200]})}

    def _create_outline(self, book: BatchGenerationBook, asset: BatchGenerationAsset) -> None:
        bookmarks = _load(asset.bookmarks_json)
        analysis = _load(asset.analysis_json)
        candidates = bookmarks or [{**item, "level": 1} for item in analysis.get("heading_candidates", [])]
        if not candidates:
            candidates = [{"title": book.title, "page": 1, "level": 1}]
        normalized = []
        seen = set()
        for item in candidates:
            key = (item["title"], item["page"])
            if key not in seen:
                seen.add(key)
                normalized.append(item)
        for index, item in enumerate(normalized):
            end_page = normalized[index + 1]["page"] - 1 if index + 1 < len(normalized) else asset.page_count
            section = BatchGenerationSection(id=str(uuid.uuid4()), book_id=book.id, title=item["title"], level=int(item.get("level", 1)), start_page=max(1, int(item["page"])), end_page=max(int(item["page"]), end_page), output_mode=book.default_output_mode, operation_id=str(uuid.uuid4()), sort_order=index)
            self.session.add(section)

    def _quality_check(self, section: BatchGenerationSection, kind: str, content: dict[str, Any]) -> None:
        self.session.query(BatchGenerationQualityIssue).filter_by(section_id=section.id, resolved=False).update({"resolved": True})
        issues = []
        if not content:
            issues.append(("empty_output", "error", "草稿内容为空"))
        if section.end_page - section.start_page > 80:
            issues.append(("range_too_large", "warning", "单节页数过多，建议拆分以减少 token 浪费"))
        if kind == "quiz" and isinstance(content.get("questions"), list):
            stems = [str(item.get("stem", "")).strip() for item in content["questions"]]
            if len(stems) != len(set(stems)):
                issues.append(("duplicate_question", "warning", "候选题中存在重复题干"))
        for issue_kind, severity, message in issues:
            self.session.add(BatchGenerationQualityIssue(id=str(uuid.uuid4()), section_id=section.id, kind=issue_kind, severity=severity, message=message, details_json="{}"))

    def _asset_record(self, asset: BatchGenerationAsset) -> dict[str, Any]:
        return {"id": asset.id, "role": asset.role, "original_name": asset.original_name, "sha256": asset.sha256, "file_size": asset.file_size, "page_count": asset.page_count, "text_page_count": asset.text_page_count, "scanned_page_count": asset.scanned_page_count, "bookmarks": _load(asset.bookmarks_json), "analysis": _load(asset.analysis_json)}

    def _section_record(self, section: BatchGenerationSection) -> dict[str, Any]:
        issues = self.session.query(BatchGenerationQualityIssue).filter_by(section_id=section.id, resolved=False).all()
        drafts = self.session.query(BatchGenerationDraft).filter_by(section_id=section.id).all()
        return {"id": section.id, "title": section.title, "level": section.level, "start_page": section.start_page, "end_page": section.end_page, "output_mode": section.output_mode, "status": section.status, "operation_id": section.operation_id, "existing_chapter_id": section.existing_chapter_id, "existing_palace_id": section.existing_palace_id, "match_confidence": section.match_confidence, "excluded": section.excluded, "sort_order": section.sort_order, "revision": section.revision, "drafts": [{"kind": draft.kind, "content": _load(draft.content_json), "quality_score": draft.quality_score} for draft in drafts], "issues": [{"id": issue.id, "kind": issue.kind, "severity": issue.severity, "message": issue.message} for issue in issues]}
