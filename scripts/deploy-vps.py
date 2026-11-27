#!/usr/bin/env python3
"""Publish or roll back a static release on the Almiron VPS."""

import argparse
import filecmp
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import time

RELEASE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


def release_id(value):
    if not RELEASE_ID.fullmatch(value):
        raise ValueError(f"Invalid release ID: {value}")
    return value


def asset_files(directory):
    for source in sorted(directory.rglob("*")):
        if source.is_symlink() or not (source.is_dir() or source.is_file()):
            raise ValueError(f"Unsupported asset: {source}")
        if source.is_file():
            yield source


def publish_assets(assets, shared):
    if assets.is_symlink() or not assets.is_dir():
        raise ValueError(f"Invalid asset directory: {assets}")
    for source in asset_files(assets):
        relative = source.relative_to(assets)
        if any(part.startswith(".") for part in relative.parts):
            raise ValueError(f"Hidden asset: {relative}")
        destination = shared / relative
        if destination.parent.resolve() != destination.parent or destination.is_symlink():
            raise ValueError(f"Unexpected symlink in asset store: {relative}")
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        if destination.exists():
            if not destination.is_file() or not filecmp.cmp(source, destination, shallow=False):
                raise ValueError(f"Different bytes for immutable asset: {relative}")
            continue

        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".publish-", delete=False) as output:
            temporary = Path(output.name)
            try:
                with source.open("rb") as input_file:
                    shutil.copyfileobj(input_file, output)
                output.flush()
                os.fsync(output.fileno())
            except BaseException:
                output.close()
                temporary.unlink(missing_ok=True)
                raise
        try:
            temporary.chmod(0o644)
            os.link(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)


def check_release(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"Invalid release directory: {path}")
    for name in ("index.html", "version.json"):
        entry = path / name
        if entry.is_symlink() or not entry.is_file() or entry.stat().st_size == 0:
            raise ValueError(f"Invalid release file: {entry}")
    if json.loads((path / "version.json").read_text(encoding="utf-8")) != {"build_id": path.name}:
        raise ValueError(f"Build ID differs from release path: {path}")


def write_legacy_version(release):
    version = release / "version.json"
    if version.exists() or version.is_symlink():
        return
    with tempfile.NamedTemporaryFile(dir=release, prefix=".version-", delete=False, mode="w", encoding="utf-8") as output:
        temporary = Path(output.name)
        json.dump({"build_id": release_id(release.name)}, output)
    try:
        temporary.chmod(0o644)
        os.link(temporary, version)
    finally:
        temporary.unlink(missing_ok=True)


def seed_assets(releases, shared):
    retained = [
        release for release in sorted(releases.iterdir())
        if not release.name.startswith(".") and release.is_dir() and not release.is_symlink()
    ]
    for release in retained:
        publish_assets(release / "assets", shared)
    for release in retained:
        write_legacy_version(release)


def install_release(releases, shared, name, archive):
    release = releases / name
    if release.exists() or release.is_symlink():
        raise FileExistsError(f"Release already exists: {release}")
    with tempfile.TemporaryDirectory(prefix=".incoming-", dir=releases) as incoming:
        staged = Path(incoming) / name
        staged.mkdir(mode=0o755)
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle.getmembers():
                if not (member.isdir() or member.isfile()):
                    raise ValueError(f"Unsupported archive entry: {member.name}")
            bundle.extractall(staged, filter="data")
        check_release(staged)
        for entry in staged.rglob("*"):
            entry.chmod(0o755 if entry.is_dir() else 0o644)
        publish_assets(staged / "assets", shared)
        staged.rename(release)
    return release


def activate(root, release):
    with tempfile.TemporaryDirectory(prefix=".activate-", dir=root) as switching:
        next_link = Path(switching) / "current"
        next_link.symlink_to(release, target_is_directory=True)
        os.replace(next_link, root / "current")


def dry_run_cleanup(root, min_age_days):
    if min_age_days < 30:
        raise ValueError("Keep unreferenced assets for at least 30 days")
    root = root.resolve(strict=True)
    releases = root / "releases"
    shared = root / "shared" / "assets"
    current = root / "current"
    if not current.is_symlink() or releases.resolve() != releases or shared.resolve() != shared:
        raise ValueError("Unexpected release layout")
    active = current.resolve(strict=True)
    retained = sorted(path for path in releases.iterdir() if not path.name.startswith("."))
    if active not in retained or not shared.is_dir():
        raise ValueError("Cannot verify the active release or shared asset directory")
    protected = set()
    for release in retained:
        directory = release / "assets"
        if release.is_symlink() or directory.is_symlink() or not directory.is_dir():
            raise ValueError(f"Cannot verify retained release: {release}")
        protected.update(path.relative_to(directory) for path in asset_files(directory))
    cutoff = time.time() - min_age_days * 86400
    candidates = [
        {"path": path.relative_to(shared).as_posix(), "bytes": path.stat().st_size}
        for path in asset_files(shared)
        if path.relative_to(shared) not in protected and path.stat().st_mtime < cutoff
    ]
    if active != current.resolve(strict=True) or retained != sorted(path for path in releases.iterdir() if not path.name.startswith(".")):
        raise ValueError("Release set changed during inventory; run again")
    return {"mode": "dry-run", "retained_releases": [path.name for path in retained],
            "protected_assets": len(protected), "candidates": candidates}


def run(root, action, name=None, archive=None):
    import fcntl

    root = root.resolve(strict=True)
    releases = root / "releases"
    shared = root / "shared" / "assets"
    with (root / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if releases.resolve() != releases or shared.resolve() != shared:
            raise ValueError("Release and asset directories must be real directories")
        current = root / "current"
        if current.is_symlink():
            if current.resolve(strict=True).parent != releases:
                raise ValueError("Current must point to a retained release directory")
        elif current.exists():
            raise ValueError("Current must be a symlink")
        releases.mkdir(exist_ok=True)
        shared.mkdir(parents=True, exist_ok=True)
        seeded = shared.parent / ".seeded"
        if action == "seed":
            seed_assets(releases, shared)
            seeded.touch()
            return
        if not seeded.is_file():
            raise ValueError("Seed the shared asset store before switching releases")
        if action == "deploy":
            release = install_release(releases, shared, name, archive)
        else:
            release = releases / name
            check_release(release)
            publish_assets(release / "assets", shared)
        activate(root, release)
        print(f"Activated {release.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/srv/almiron"))
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("seed")
    deploy = commands.add_parser("deploy")
    deploy.add_argument("name", type=release_id)
    deploy.add_argument("archive", type=Path)
    commands.add_parser("rollback").add_argument("name", type=release_id)
    cleanup = commands.add_parser("cleanup-dry-run")
    cleanup.add_argument("--min-age-days", type=int, default=30)
    args = parser.parse_args()
    if args.action == "cleanup-dry-run":
        print(json.dumps(dry_run_cleanup(args.root, args.min_age_days), ensure_ascii=False, indent=2))
    else:
        run(args.root, args.action, getattr(args, "name", None), getattr(args, "archive", None))
