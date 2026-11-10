"""Regression tests for AI HOT article image normalization."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("sync_aihot_bodies", SCRIPTS / "sync_aihot_bodies.py")
bodies = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(bodies)


class FakeReader:
    def __init__(self, blocks):
        self.blocks = blocks

    def item(self, identifier, refresh=False):
        assert identifier == "item-1"
        assert refresh is False
        return {
            "schemaVersion": 1,
            "id": identifier,
            "status": "available",
            "provenance": "aihot-public-page",
            "sourceURL": "https://aihot.news/items/item-1",
            "fetchedAt": "2026-11-10T00:00:00Z",
            "label": "正文",
            "notice": "",
            "topics": [],
            "tags": [],
            "languages": {"zh": {"label": "中文", "blocks": self.blocks}},
        }


def image(source):
    return {"type": "image", "src": source, "alt": ""}


class SnapshotBodyImageTests(unittest.TestCase):
    def snapshot(self, blocks, external):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "media").mkdir()
            with mock.patch.object(bodies, "snapshot_media", return_value=False), \
                    mock.patch.object(bodies, "snapshot_external_media", side_effect=external):
                payload, count = bodies.snapshot_body(
                    FakeReader(blocks), {"id": "item-1"}, output, False
                )
            return payload, count

    def test_unsupported_images_are_removed_before_publish_validation(self):
        payload, count = self.snapshot(
            [{"type": "paragraph", "text": "可读正文"}, image("https://example.com/logo.svg")],
            lambda *args: False,
        )
        self.assertEqual(count, 0)
        self.assertEqual(
            [block["type"] for block in payload["languages"]["zh"]["blocks"]],
            ["paragraph"],
        )
        self.assertIn("不支持的图片地址", payload["notice"])

    def test_images_beyond_limit_are_removed(self):
        blocks = [image("https://example.com/" + str(index) + ".png")
                  for index in range(bodies.MAX_EXTERNAL_IMAGES + 1)]

        def snapshot_external(reader, block, media_dir, force):
            name = str(len(list(media_dir.glob("*"))) + 1).zfill(64) + ".png"
            (media_dir / name).write_bytes(b"image")
            block["src"] = "aihot/media/" + name
            return True

        payload, count = self.snapshot(blocks, snapshot_external)
        self.assertEqual(count, bodies.MAX_EXTERNAL_IMAGES)
        retained = payload["languages"]["zh"]["blocks"]
        self.assertEqual(len(retained), bodies.MAX_EXTERNAL_IMAGES)
        self.assertTrue(all(block["src"].startswith("aihot/media/") for block in retained))
        self.assertIn("不支持的图片地址", payload["notice"])

    def test_language_is_dropped_when_all_blocks_are_unsupported(self):
        payload, count = self.snapshot(
            [image("https://example.com/logo.svg")],
            lambda *args: False,
        )
        self.assertEqual(count, 0)
        self.assertEqual(payload["languages"], {})
        self.assertIn("不支持的图片地址", payload["notice"])


if __name__ == "__main__":
    unittest.main()
