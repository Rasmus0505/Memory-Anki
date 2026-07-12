from __future__ import annotations

import base64
import mimetypes
from typing import Any


def build_image_content_part(
    *,
    image_bytes: bytes,
    filename: str | None,
) -> dict[str, Any]:
    mime_type = mimetypes.guess_type(filename or "")[0] or "image/png"
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    image_url = f"data:{mime_type};base64,{image_base64}"
    return {"type": "image_url", "image_url": {"url": image_url}}


def extract_first_json_object(value: str) -> str | None:
    text = str(value or "")
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return text[start : index + 1]
        start = text.find("{", start + 1)
    return None
