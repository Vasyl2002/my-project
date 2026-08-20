"""Чтение tasks.json и comments.txt."""

from __future__ import annotations

import json
from pathlib import Path

from loguru import logger


def load_tasks(tasks_file: Path) -> list[str]:
    """Возвращает список URL из JSON-массива или из ключей urls/posts/tasks."""
    if not tasks_file.exists():
        raise FileNotFoundError(f"Не найден файл задач: {tasks_file}")
    raw = json.loads(tasks_file.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("urls") or raw.get("posts") or raw.get("tasks") or []
    if not isinstance(raw, list):
        raise ValueError("tasks.json должен содержать JSON-список URL")
    urls = [str(item).strip() for item in raw if str(item).strip()]
    logger.info("Загружено задач: {}", len(urls))
    return urls


def load_comments(comments_file: Path) -> list[str]:
    """Читает варианты комментариев: одна непустая строка = один вариант."""
    if not comments_file.exists():
        raise FileNotFoundError(f"Не найден файл комментариев: {comments_file}")
    lines = [
        line.strip()
        for line in comments_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if not lines:
        raise ValueError("comments.txt пуст — добавьте хотя бы один текст комментария")
    logger.info("Загружено вариантов комментариев: {}", len(lines))
    return lines
