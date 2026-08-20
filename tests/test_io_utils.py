"""Проверки загрузки tasks.json / comments.txt без Undetectable и браузера."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from fb_comment_bot.io_utils import load_comments, load_tasks


class LoadTasksTests(unittest.TestCase):
    def test_load_tasks_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tasks.json"
            path.write_text(
                json.dumps(["https://facebook.com/a", " https://facebook.com/b "]),
                encoding="utf-8",
            )
            self.assertEqual(
                load_tasks(path),
                ["https://facebook.com/a", "https://facebook.com/b"],
            )

    def test_load_tasks_dict_posts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tasks.json"
            path.write_text(json.dumps({"posts": ["https://facebook.com/p"]}), encoding="utf-8")
            self.assertEqual(load_tasks(path), ["https://facebook.com/p"])


class LoadCommentsTests(unittest.TestCase):
    def test_skips_blank_and_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "comments.txt"
            path.write_text("# hint\n\nHello\nWorld\n", encoding="utf-8")
            self.assertEqual(load_comments(path), ["Hello", "World"])

    def test_empty_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "comments.txt"
            path.write_text("\n# only comment\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_comments(path)


if __name__ == "__main__":
    unittest.main()
