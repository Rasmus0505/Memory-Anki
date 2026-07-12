from __future__ import annotations

import argparse
import ast
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parents[1]
SYSTEM_MAP = REPO_ROOT / "docs" / "architecture" / "system-map.yaml"
USE_CASES = REPO_ROOT / "docs" / "architecture" / "use-cases.yaml"
API_MODULES = REPO_ROOT / "apps" / "api" / "src" / "memory_anki" / "modules"
WEB_MODULES = REPO_ROOT / "apps" / "web" / "src" / "modules"


@dataclass(frozen=True, slots=True)
class ArchitectureModule:
    name: str
    dependencies: frozenset[str]
    table_prefixes: tuple[str, ...]


def load_json_yaml(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_modules(path: Path = SYSTEM_MAP) -> dict[str, ArchitectureModule]:
    payload = load_json_yaml(path)
    return {
        name: ArchitectureModule(
            name=name,
            dependencies=frozenset(config["dependencies"]),
            table_prefixes=tuple(config["tablePrefixes"]),
        )
        for name, config in payload["modules"].items()
    }


def python_imports(path: Path) -> Iterable[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module


def module_from_import(import_name: str) -> tuple[str, str] | None:
    prefix = "memory_anki.modules."
    if not import_name.startswith(prefix):
        return None
    remainder = import_name.removeprefix(prefix)
    parts = remainder.split(".")
    return parts[0], ".".join(parts[1:])


def check_module_shape(errors: list[str], modules: dict[str, ArchitectureModule]) -> None:
    required_layers = set(load_json_yaml(SYSTEM_MAP)["layers"])
    for name in modules:
        api_root = API_MODULES / name
        web_root = WEB_MODULES / name
        for root, public_entry in ((api_root, "public.py"), (web_root, "public.ts")):
            if not root.is_dir():
                errors.append(f"{root.relative_to(REPO_ROOT).as_posix()}: module directory is missing")
                continue
            missing = sorted(layer for layer in required_layers if not (root / layer).is_dir())
            if missing:
                errors.append(f"{root.relative_to(REPO_ROOT).as_posix()}: missing layers {missing}")
            if not (root / public_entry).is_file():
                errors.append(f"{root.relative_to(REPO_ROOT).as_posix()}: missing {public_entry}")
        if not (api_root / "README.md").is_file():
            errors.append(f"{api_root.relative_to(REPO_ROOT).as_posix()}: missing AI navigation README.md")


def check_backend_dependencies(errors: list[str], modules: dict[str, ArchitectureModule]) -> None:
    for owner, config in modules.items():
        root = API_MODULES / owner
        for path in root.rglob("*.py"):
            for imported in python_imports(path):
                target = module_from_import(imported)
                if target is None or target[0] == owner:
                    continue
                target_name, target_path = target
                if target_name not in modules:
                    continue
                relative = path.relative_to(REPO_ROOT).as_posix()
                if target_name not in config.dependencies:
                    errors.append(f"{relative}: {owner} cannot depend on {target_name}")
                if target_path and not (
                    target_path == "public"
                    or target_path.startswith("contract")
                ):
                    errors.append(
                        f"{relative}: cross-module imports must use {target_name}.public or {target_name}.contract"
                    )


def check_frontend_dependencies(errors: list[str], modules: dict[str, ArchitectureModule]) -> None:
    for owner, config in modules.items():
        root = WEB_MODULES / owner
        for path in (*root.rglob("*.ts"), *root.rglob("*.tsx")):
            content = path.read_text(encoding="utf-8")
            for target_name in modules:
                marker = f"@/modules/{target_name}/"
                if target_name == owner or marker not in content:
                    continue
                relative = path.relative_to(REPO_ROOT).as_posix()
                if target_name not in config.dependencies:
                    errors.append(f"{relative}: {owner} cannot depend on {target_name}")
                if f"@/modules/{target_name}/public" not in content:
                    errors.append(f"{relative}: cross-module imports must use {target_name}/public")


def check_use_case_catalog(errors: list[str], modules: dict[str, ArchitectureModule]) -> None:
    payload = load_json_yaml(USE_CASES)
    for name, use_case in payload.get("useCases", {}).items():
        owner = use_case.get("owner")
        if owner not in modules:
            errors.append(f"docs/architecture/use-cases.yaml: {name} has unknown owner {owner}")
        tests = use_case.get("tests", [])
        if not tests:
            errors.append(f"docs/architecture/use-cases.yaml: {name} must register tests")
        for test in tests:
            if not (REPO_ROOT / test).is_file():
                errors.append(f"docs/architecture/use-cases.yaml: {name} test does not exist: {test}")


def run_checks() -> list[str]:
    modules = load_modules()
    errors: list[str] = []
    check_module_shape(errors, modules)
    check_backend_dependencies(errors, modules)
    check_frontend_dependencies(errors, modules)
    check_use_case_catalog(errors, modules)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Architecture V3 manifests and boundaries.")
    parser.parse_args()
    errors = run_checks()
    if errors:
        print("Architecture V3 check failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Architecture V3 check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
