from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from memory_anki.modules.english_lookup.application.service import (
    lookup_audio,
    lookup_bing,
    lookup_caiyun,
    lookup_cambridge,
    lookup_collins,
    lookup_oxford,
    lookup_vocabulary,
    lookup_voice,
    translate_english_text,
)
from memory_anki.modules.english_lookup.domain.errors import EnglishLookupError

router = APIRouter(tags=["english-lookup"])


@router.get("/english-lookup/translate")
def api_english_lookup_translate(
    q: str = Query(..., min_length=1, max_length=1000, description="Text translated to Simplified Chinese"),
):
    try:
        return translate_english_text(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/english-lookup/caiyun")
def api_english_lookup_caiyun(
    q: str = Query(..., min_length=1, max_length=1000, description="Text translated to Simplified Chinese"),
):
    try:
        return lookup_caiyun(q)
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


@router.get("/english-lookup/oxford")
def api_english_lookup_oxford(
    q: str = Query(..., min_length=1, max_length=1000, description="1–5 English words"),
):
    try:
        return lookup_oxford(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/english-lookup/bing")
def api_english_lookup_bing(
    q: str = Query(..., min_length=1, max_length=1000, description="1–5 English words"),
):
    try:
        return lookup_bing(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/english-lookup/collins")
def api_english_lookup_collins(
    q: str = Query(..., min_length=1, max_length=1000, description="1–5 English words"),
):
    try:
        return lookup_collins(q)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/english-lookup/audio")
def api_english_lookup_audio(
    url: str = Query(..., min_length=8, max_length=2000, description="HTTPS dictionary MP3 URL"),
):
    try:
        body, media_type = lookup_audio(url)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return Response(
        content=body,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/english-lookup/voice")
def api_english_lookup_voice(
    q: str = Query(..., min_length=1, max_length=1000, description="1–5 English words"),
    accent: str = Query("us", min_length=2, max_length=8),
):
    try:
        body, media_type = lookup_voice(q, accent)
    except EnglishLookupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return Response(
        content=body,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
