"""CLI: парсинг аргументов и запуск бота."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from loguru import logger

from fb_comment_bot.config import DEFAULT_COMMENTS_FILE, DEFAULT_TASKS_FILE
from fb_comment_bot.logger import setup_logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Автокомментирование постов Facebook через AdsPower Local API и Playwright.",
    )
    parser.add_argument(
        "--profile-id",
        "-p",
        required=True,
        help="AdsPower user_id профиля, уже залогиненного в Facebook",
    )
    parser.add_argument(
        "--tasks",
        type=Path,
        default=DEFAULT_TASKS_FILE,
        help="JSON-файл со списком URL постов (по умолчанию tasks.json)",
    )
    parser.add_argument(
        "--comments",
        type=Path,
        default=DEFAULT_COMMENTS_FILE,
        help="Текстовый файл с вариантами комментариев, по одному на строку",
    )
    return parser.parse_args()


async def async_main() -> None:
    setup_logger()
    args = parse_args()
    # Playwright тянется только при реальном запуске, не на --help.
    from fb_comment_bot.bot import FacebookCommentBot

    logger.info("Старт бота для профиля {}", args.profile_id)
    bot = FacebookCommentBot(
        profile_id=args.profile_id,
        tasks_file=args.tasks,
        comments_file=args.comments,
    )
    await bot.run()


def main() -> None:
    asyncio.run(async_main())
