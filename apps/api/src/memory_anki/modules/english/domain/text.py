from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

PUNCT_EDGE_RE = re.compile(r"^[\s\.,!?;:\"'`~\-\(\)\[\]\{\}]+|[\s\.,!?;:\"'`~\-\(\)\[\]\{\}]+$")
USD_AMOUNT_RE = re.compile(r"(?<![A-Za-z0-9])\$(\d[\d,]*)(?:\.(\d{1,2}))?(?![A-Za-z0-9])")

NUMBER_WORDS_LT_20 = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
]
NUMBER_WORDS_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
NUMBER_WORDS_SCALES = [
    (1_000_000_000_000, "trillion"),
    (1_000_000_000, "billion"),
    (1_000_000, "million"),
    (1_000, "thousand"),
]


@dataclass(frozen=True, slots=True)
class EnglishSentenceCheckResult:
    passed: bool
    token_results: list[dict[str, Any]]
    normalized_input: list[str]
    normalized_expected: list[str]


def check_sentence_tokens(expected_tokens: list[str], input_text: str) -> EnglishSentenceCheckResult:
    normalized_expected = [
        normalize_token(token)
        for token in normalize_learning_token_list(expected_tokens)
        if normalize_token(token)
    ]
    normalized_input = tokenize_learning_sentence(input_text)
    max_len = max(len(normalized_expected), len(normalized_input))
    passed = len(normalized_expected) == len(normalized_input)
    token_results: list[dict[str, Any]] = []
    for index in range(max_len):
        expected = normalized_expected[index] if index < len(normalized_expected) else ""
        actual = normalized_input[index] if index < len(normalized_input) else ""
        correct = bool(expected and actual and expected == actual)
        if expected != actual:
            passed = False
        token_results.append(
            {
                "input": actual,
                "correct": correct,
                "missing": bool(expected and not actual),
                "unexpected": bool(actual and not expected),
            }
        )
    return EnglishSentenceCheckResult(
        passed=passed,
        token_results=token_results,
        normalized_input=normalized_input,
        normalized_expected=normalized_expected,
    )


def normalize_token(token: str) -> str:
    normalized = (token or "").strip().lower().replace("’", "'")
    return PUNCT_EDGE_RE.sub("", normalized)


def tokenize_sentence(sentence: str) -> list[str]:
    raw_tokens = re.split(r"\s+", (sentence or "").strip())
    return [token for token in (normalize_token(item) for item in raw_tokens) if token]


def tokenize_learning_sentence(sentence: str) -> list[str]:
    return tokenize_sentence(normalize_learning_english_text(sentence))


def normalize_learning_token_list(tokens: list[str]) -> list[str]:
    output: list[str] = []
    for item in list(tokens or []):
        output.extend(tokenize_learning_sentence(str(item or "")))
    return output


def normalize_learning_english_text(text: str) -> str:
    source = str(text or "").strip()
    if not source:
        return ""

    def replace(match: re.Match[str]) -> str:
        return usd_amount_to_spoken_text(match.group(1), match.group(2))

    return USD_AMOUNT_RE.sub(replace, source)


def usd_amount_to_spoken_text(dollar_text: str, cent_text: str | None) -> str:
    dollars = int((dollar_text or "0").replace(",", "") or "0")
    cents = 0
    if cent_text:
        cents = int(str(cent_text).ljust(2, "0")[:2])
    dollar_words = ""
    if dollars > 0 or cents == 0:
        dollar_unit = "dollar" if dollars == 1 else "dollars"
        dollar_words = f"{integer_to_english(dollars)} {dollar_unit}"
    if cents <= 0:
        return dollar_words
    cent_unit = "cent" if cents == 1 else "cents"
    cent_words = f"{integer_to_english(cents)} {cent_unit}"
    if dollars <= 0:
        return cent_words
    return f"{dollar_words} and {cent_words}"


def integer_to_english(value: int) -> str:
    if value < 20:
        return NUMBER_WORDS_LT_20[value]
    if value < 100:
        tens, remainder = divmod(value, 10)
        head = NUMBER_WORDS_TENS[tens]
        return head if remainder == 0 else f"{head}-{integer_to_english(remainder)}"
    if value < 1000:
        hundreds, remainder = divmod(value, 100)
        head = f"{integer_to_english(hundreds)} hundred"
        return head if remainder == 0 else f"{head} {integer_to_english(remainder)}"
    for scale_value, scale_name in NUMBER_WORDS_SCALES:
        if value >= scale_value:
            major, remainder = divmod(value, scale_value)
            head = f"{integer_to_english(major)} {scale_name}"
            return head if remainder == 0 else f"{head} {integer_to_english(remainder)}"
    return str(value)
