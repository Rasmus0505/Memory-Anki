from __future__ import annotations

from dataclasses import dataclass

IMAGE_TEXT_TOTAL_STEPS = 3
IMAGE_MINDMAP_TOTAL_STEPS = 4
BATCH_MINDMAP_TOTAL_STEPS = 4


@dataclass(frozen=True)
class ImportStep:
    phase: str
    message: str
    step: int
    total_steps: int

    def as_payload(self) -> dict[str, int | str]:
        return {
            "phase": self.phase,
            "message": self.message,
            "step": self.step,
            "total_steps": self.total_steps,
        }


def validate_single_image_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="validating",
        message="正在校验图片内容",
        step=1,
        total_steps=total_steps,
    )


def recognize_single_image_structure_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="calling_model",
        message="正在识别图片结构",
        step=2,
        total_steps=total_steps,
    )


def extract_single_image_text_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="calling_model",
        message="正在提取图片文字",
        step=2,
        total_steps=total_steps,
    )


def normalize_tree_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="normalizing_tree",
        message="正在整理脑图结构",
        step=3,
        total_steps=total_steps,
    )


def normalize_text_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="normalizing_text",
        message="正在整理提取结果",
        step=3,
        total_steps=total_steps,
    )


def build_preview_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="building_preview",
        message="正在生成脑图草稿",
        step=total_steps,
        total_steps=total_steps,
    )


def validate_image_batch_step() -> ImportStep:
    return ImportStep(
        phase="validating_images",
        message="正在校验图片队列",
        step=1,
        total_steps=BATCH_MINDMAP_TOTAL_STEPS,
    )


def extract_batch_structure_step() -> ImportStep:
    return ImportStep(
        phase="extracting_structure",
        message="正在提取结构图",
        step=2,
        total_steps=BATCH_MINDMAP_TOTAL_STEPS,
    )


def enhance_batch_with_body_step() -> ImportStep:
    return ImportStep(
        phase="enhancing_with_body",
        message="正在结合正文图片补全脑图",
        step=3,
        total_steps=BATCH_MINDMAP_TOTAL_STEPS,
    )


def generate_batch_mindmap_direct_step() -> ImportStep:
    return ImportStep(
        phase="generating_mindmap",
        message="正在综合图片直接生成脑图",
        step=3,
        total_steps=BATCH_MINDMAP_TOTAL_STEPS,
    )
