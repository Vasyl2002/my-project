"""Настройка loguru: консоль + файл bot.log."""

from __future__ import annotations

import sys

from loguru import logger

from fb_comment_bot.config import LOG_FILE


def setup_logger() -> None:
    """Инициализирует логгер один раз на процесс."""
    logger.remove()
    logger.add(
        sys.stderr,
        colorize=True,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan> — "
            "<level>{message}</level>"
        ),
        level="INFO",
    )
    logger.add(
        LOG_FILE,
        encoding="utf-8",
        rotation="5 MB",
        retention="14 days",
        enqueue=True,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function} — {message}",
        level="DEBUG",
    )
