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


def extract_single_image_text_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="calling_model",
        message="正在识别页面全部文字",
        step=2,
        total_steps=total_steps,
    )


def normalize_tree_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="normalizing_tree",
        message="正在整理脑图 JSON",
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


def extract_all_pages_text_step() -> ImportStep:
    return ImportStep(
        phase="extracting_text",
        message="正在识别全部上传页文字",
        step=2,
        total_steps=BATCH_MINDMAP_TOTAL_STEPS,
    )


def format_mindmap_json_step() -> ImportStep:
    return ImportStep(
        phase="formatting_mindmap",
        message="正在按范围整理脑图 JSON",
        step=3,
        total_steps=BATCH_MINDMAP_TOTAL_STEPS,
    )
