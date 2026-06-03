from __future__ import annotations

from dataclasses import dataclass

IMAGE_TEXT_TOTAL_STEPS = 3
IMAGE_MINDMAP_TOTAL_STEPS = 4
BATCH_MINDMAP_TOTAL_STEPS = 4
PDF_TEXT_TOTAL_STEPS = 3
PDF_IMPORT_TOTAL_STEPS = 4


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


def render_pdf_pages_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="rendering_pages",
        message="正在渲染 PDF 页面",
        step=1,
        total_steps=total_steps,
    )


def extract_pdf_text_step(*, total_steps: int) -> ImportStep:
    return ImportStep(
        phase="extracting_text",
        message="正在提取 PDF 文字",
        step=2,
        total_steps=total_steps,
    )


def extract_selected_pdf_ocr_step() -> ImportStep:
    return ImportStep(
        phase="ocr",
        message="正在提取所选页 OCR",
        step=2,
        total_steps=PDF_IMPORT_TOTAL_STEPS,
    )


def generate_pdf_mindmap_direct_step() -> ImportStep:
    return ImportStep(
        phase="generating_mindmap",
        message="正在综合正文与图片直接生成脑图",
        step=3,
        total_steps=PDF_IMPORT_TOTAL_STEPS,
    )


def recognize_pdf_structure_step(*, structure_page: int) -> ImportStep:
    return ImportStep(
        phase="structure",
        message=f"正在识别结构页（第 {structure_page} 页）脑图",
        step=2,
        total_steps=PDF_IMPORT_TOTAL_STEPS,
    )


def extract_pdf_body_ocr_step() -> ImportStep:
    return ImportStep(
        phase="ocr",
        message="正在提取正文页 OCR",
        step=3,
        total_steps=PDF_IMPORT_TOTAL_STEPS,
    )


def skip_pdf_body_ocr_step() -> ImportStep:
    return ImportStep(
        phase="ocr",
        message="未选择正文页，跳过正文 OCR",
        step=3,
        total_steps=PDF_IMPORT_TOTAL_STEPS,
    )


def merge_pdf_body_step() -> ImportStep:
    return ImportStep(
        phase="merge",
        message="正在把正文补到结构节点下",
        step=4,
        total_steps=PDF_IMPORT_TOTAL_STEPS,
    )


def skip_pdf_body_merge_step() -> ImportStep:
    return ImportStep(
        phase="merge",
        message="仅恢复结构页脑图，不补充正文内容",
        step=4,
        total_steps=PDF_IMPORT_TOTAL_STEPS,
    )
