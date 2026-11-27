import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deploy-vps.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.releases = self.root / "releases"
        self.shared = self.root / "shared" / "assets"
        self.releases.mkdir()
        self.shared.mkdir(parents=True)

    def legacy(self, name, assets):
        release = self.releases / name
        (release / "assets").mkdir(parents=True)
        (release / "index.html").write_text(name)
        for filename, value in assets.items():
            (release / "assets" / filename).write_bytes(value)
        return release

    def archive(self, name, assets, build_id=None):
        archive = self.root / f"{name}.tar.gz"
        entries = {
            "index.html": b"<html></html>",
            "version.json": json.dumps({"build_id": build_id or name}).encode(),
            **{f"assets/{filename}": value for filename, value in assets.items()},
        }
        with tarfile.open(archive, "w:gz") as bundle:
            for filename, value in entries.items():
                member = tarfile.TarInfo(filename)
                member.size = len(value)
                bundle.addfile(member, io.BytesIO(value))
        return archive

    def test_seed_and_publish_preserve_both_releases(self):
        initial = self.legacy("initial", {"old-A.js": b"old", "fixed.css": b"css"})
        self.legacy("legacy", {"old-B.js": b"other", "fixed.css": b"css"})
        deploy.seed_assets(self.releases, self.shared)
        self.assertEqual(json.loads((initial / "version.json").read_text()), {"build_id": "initial"})
        bundle = self.archive("new", {"new-C.js": b"new", "fixed.css": b"css"})
        result = deploy.install_release(self.releases, self.shared, "new", bundle)
        self.assertEqual(result, self.releases / "new")
        self.assertEqual(sorted(f.name for f in self.shared.iterdir()), ["fixed.css", "new-C.js", "old-A.js", "old-B.js"])

    def test_collision_preserves_existing_file_and_rejects_release(self):
        active = self.legacy("initial", {"fixed.js": b"old"})
        deploy.seed_assets(self.releases, self.shared)
        conflicting = self.archive("new", {"fixed.js": b"new"})
        with self.assertRaisesRegex(ValueError, "Different bytes"):
            deploy.install_release(self.releases, self.shared, "new", conflicting)
        self.assertEqual((self.shared / "fixed.js").read_bytes(), b"old")
        self.assertTrue(active.is_dir())
        self.assertFalse((self.releases / "new").exists())

    def test_reject_wrong_build_and_reusing_release_id(self):
        with self.assertRaisesRegex(ValueError, "Build ID differs"):
            deploy.install_release(self.releases, self.shared, "new", self.archive("new", {"a.js": b"a"}, "different"))
        self.legacy("initial", {"a.js": b"a"})
        with self.assertRaises(FileExistsError):
            deploy.install_release(self.releases, self.shared, "initial", self.archive("initial", {"a.js": b"a"}))

    @unittest.skipUnless(os.name == "posix", "requires POSIX flock and atomic symlink replacement")
    def test_activate_only_after_publish_and_rollback_keeps_new_assets(self):
        initial = self.legacy("initial", {"old.js": b"old"})
        deploy.activate(self.root, initial)
        deploy.run(self.root, "seed")
        original_activate = deploy.activate

        def verify_and_activate(root, release):
            self.assertEqual((root / "current").resolve(), initial)
            self.assertEqual((self.shared / "new.js").read_bytes(), b"new")
            original_activate(root, release)

        with patch.object(deploy, "activate", side_effect=verify_and_activate):
            deploy.run(self.root, "deploy", "candidate", self.archive("candidate", {"new.js": b"new"}))
        self.assertEqual((self.root / "current").resolve(), self.releases / "candidate")
        deploy.run(self.root, "rollback", "initial")
        self.assertEqual((self.root / "current").resolve(), initial)
        self.assertEqual((self.shared / "new.js").read_bytes(), b"new")

    @unittest.skipUnless(os.name == "posix", "requires a real POSIX symlink")
    def test_cleanup_only_lists_old_unreferenced_files_without_writing(self):
        current = self.legacy("current-release", {"current.js": b"current"})
        self.legacy("old-release", {"old.js": b"old"})
        deploy.activate(self.root, current)
        deploy.seed_assets(self.releases, self.shared)
        old_time = time.time() - 40 * 86400
        for name in ["cold.js", "fresh.js"]:
            (self.shared / name).write_bytes(b"fixture")
        for name in ["cold.js", "old.js"]:
            os.utime(self.shared / name, (old_time, old_time))
        before = sorted(self.root.rglob("*"))
        report = deploy.dry_run_cleanup(self.root, 30)
        self.assertEqual(report["candidates"], [{"path": "cold.js", "bytes": 7}])
        self.assertEqual(sorted(self.root.rglob("*")), before)
        self.assertFalse((self.root / ".deploy.lock").exists())


if __name__ == "__main__":
    unittest.main()
