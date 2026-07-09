from __future__ import annotations

import importlib.util
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CHECK_ARCHITECTURE_PATH = REPO_ROOT / "tools" / "check_architecture.py"

spec = importlib.util.spec_from_file_location("check_architecture", CHECK_ARCHITECTURE_PATH)
assert spec is not None
check_architecture = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(check_architecture)


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_frontend_generated_api_boundary_blocks_direct_production_imports(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(web_src / "shared" / "api" / "generated.ts", "export type Generated = {}\n")
    write_file(
        web_src / "features" / "review" / "direct.ts",
        "import type { Generated } from '@/shared/api/generated'\n",
    )
    write_file(
        web_src / "features" / "review" / "relative.ts",
        "import type { Generated } from '../../shared/api/generated'\n",
    )

    errors: list[str] = []
    check_architecture.check_frontend_generated_api_boundary(errors)

    assert errors == [
        "features/review/direct.ts: production code must not import generated OpenAPI types directly; "
        "import stable contracts from `@/shared/api/contracts` or an owner API facade.",
        "features/review/relative.ts: production code must not import generated OpenAPI types directly; "
        "import stable contracts from `@/shared/api/contracts` or an owner API facade.",
    ]


def test_frontend_generated_api_boundary_allows_contract_wrappers_and_tests(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(web_src / "shared" / "api" / "generated.ts", "export type Generated = {}\n")
    write_file(
        web_src / "shared" / "api" / "contracts" / "index.ts",
        "export type { Generated } from '../generated'\n",
    )
    write_file(
        web_src / "features" / "review" / "generated.test.ts",
        "import type { Generated } from '@/shared/api/generated'\n",
    )
    write_file(
        web_src / "features" / "review" / "stable.ts",
        "import type { Generated } from '@/shared/api/contracts'\n",
    )

    errors: list[str] = []
    check_architecture.check_frontend_generated_api_boundary(errors)

    assert errors == []
