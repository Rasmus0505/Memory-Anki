from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from memory_anki.modules.english_lookup.application.service import (
    lookup_cambridge,
    lookup_vocabulary,
    search_english_lookup,
    translate_english_text,
)
from memory_anki.modules.english_lookup.domain.errors import EnglishLookupError

router = APIRouter(tags=["english-lookup"])


@router.get("/english-lookup/search")
def api_english_lookup_search(
    q: str = Query(..., min_length=1, max_length=1000, description="English word, phrase, or sentence"),
):
    try:
        return search_english_lookup(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/english-lookup/translate")
def api_english_lookup_translate(
    q: str = Query(..., min_length=1, max_length=1000, description="Text translated to Simplified Chinese"),
):
    try:
        return translate_english_text(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/english-lookup/vocabulary")
def api_english_lookup_vocabulary(
    q: str = Query(..., min_length=1, max_length=1000, description="1–5 English words"),
):
    try:
        return lookup_vocabulary(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/english-lookup/cambridge")
def api_english_lookup_cambridge(
    q: str = Query(..., min_length=1, max_length=1000, description="1–5 English words"),
):
    try:
        return lookup_cambridge(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
