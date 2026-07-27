"""Prune stale hashed assets from apps/web/dist.

dist 使用 emptyOutDir=false 以保住 stableChunkCompatPlugin 的旧 hash 别名链，
历史构建产物会无限累积。本脚本按 dist/releases/<releaseId>.json（由
releaseArtifactsPlugin 每次构建写出）做保留决策：

- 保留最近 KEEP_RELEASES 份清单中列出的所有 assets 文件（并集）；
- 出现在更早清单里、但不在保留并集中的文件：直接删除；
- 不出现在任何清单里的历史文件（清单机制上线前的遗留）：
  mtime 超过 LEGACY_MAX_AGE_DAYS 天才删除。阈值可以很短：PWA 在线时
  60s 轮询 + skip-waiting，旧页面存活窗口通常不到 2 分钟；3 天足以
  覆盖离线挂起的旧标签页。
- releases/ 目录本身保留最近 KEEP_MANIFESTS 份清单。

用法：
    python tools/clean_web_dist.py [--dry-run]

设计为构建成功后手动/脚本化执行（npm run build && python tools/clean_web_dist.py），
不做成 vite 插件，保证“构建成功才清理”且可独立回滚。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = REPO_ROOT / "apps" / "web" / "dist"
ASSETS_DIR = DIST_DIR / "assets"
RELEASES_DIR = DIST_DIR / "releases"

KEEP_RELEASES = 3
KEEP_MANIFESTS = 10
LEGACY_MAX_AGE_DAYS = 3


def load_manifests() -> list[tuple[Path, dict]]:
    if not RELEASES_DIR.is_dir():
        return []
    manifests: list[tuple[Path, dict]] = []
    for manifest_path in RELEASES_DIR.glob("*.json"):
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and isinstance(payload.get("files"), list):
            manifests.append((manifest_path, payload))
    # releaseId 以构建时间戳开头，文件名排序即时间排序；builtAt 作兜底。
    manifests.sort(key=lambda item: str(item[1].get("builtAt") or item[0].stem))
    return manifests


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="只打印将删除的文件，不实际删除")
    args = parser.parse_args()

    if not ASSETS_DIR.is_dir():
        print(f"skip: {ASSETS_DIR} 不存在")
        return 0

    manifests = load_manifests()
    if not manifests:
        print("skip: dist/releases 下没有可用清单；先运行一次 npm run build 生成清单再清理。")
        return 0

    kept_manifests = manifests[-KEEP_RELEASES:]
    keep_files = {
        file_name
        for _, payload in kept_manifests
        for file_name in payload["files"]
        if isinstance(file_name, str)
    }
    manifest_covered = {
        file_name
        for _, payload in manifests
        for file_name in payload["files"]
        if isinstance(file_name, str)
    }

    legacy_cutoff = time.time() - LEGACY_MAX_AGE_DAYS * 86400
    deleted_count = 0
    deleted_bytes = 0
    kept_count = 0

    for asset_path in ASSETS_DIR.iterdir():
        if not asset_path.is_file():
            continue
        relative = f"assets/{asset_path.name}"
        if relative in keep_files:
            kept_count += 1
            continue
        if relative not in manifest_covered and asset_path.stat().st_mtime > legacy_cutoff:
            # 清单机制上线前的近期文件：多观察 30 天再删，避免误伤在用旧客户端。
            kept_count += 1
            continue
        deleted_bytes += asset_path.stat().st_size
        deleted_count += 1
        if args.dry_run:
            print(f"would delete {relative}")
        else:
            asset_path.unlink()

    manifest_prune = manifests[:-KEEP_MANIFESTS] if len(manifests) > KEEP_MANIFESTS else []
    for manifest_path, _ in manifest_prune:
        if args.dry_run:
            print(f"would delete releases/{manifest_path.name}")
        else:
            manifest_path.unlink()

    action = "would delete" if args.dry_run else "deleted"
    print(
        f"{action} {deleted_count} assets ({deleted_bytes / 1024 / 1024:.1f} MB), "
        f"kept {kept_count}; manifests kept {min(len(manifests), KEEP_MANIFESTS)}, "
        f"pruned {len(manifest_prune)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
