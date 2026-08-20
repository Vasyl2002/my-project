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
        description="Автокомментирование постов Facebook через Undetectable Local API и Playwright.",
    )
    parser.add_argument(
        "--profile-id",
        "-p",
        required=True,
        help="ID профиля Undetectable, уже залогиненного в Facebook",
    )
    parser.add_argument(
        "--api-url",
        default=None,
        help="Базовый URL Local API, например http://127.0.0.1:1984",
    )
    parser.add_argument(
        "--api-port",
        type=int,
        default=None,
        help="Порт Local API Undetectable (перебивает UNDETECTABLE_PORT)",
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
    from fb_comment_bot.config import build_undetectable_base_url
    from fb_comment_bot.undetectable_client import UndetectableClient

    logger.info("Старт бота для профиля {}", args.profile_id)
    base_url = build_undetectable_base_url(api_url=args.api_url, api_port=args.api_port)
    logger.info("Undetectable Local API: {}", base_url)
    bot = FacebookCommentBot(
        profile_id=args.profile_id,
        tasks_file=args.tasks,
        comments_file=args.comments,
        undetectable=UndetectableClient(base_url=base_url),
    )
    await bot.run()


def main() -> None:
    asyncio.run(async_main())
