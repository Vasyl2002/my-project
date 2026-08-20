"""Оркестрация: Undetectable → Playwright CDP → обход задач из tasks.json."""

from __future__ import annotations

import random
from pathlib import Path

from loguru import logger
from playwright.async_api import Browser, Page, async_playwright

from fb_comment_bot.config import DEFAULT_COMMENTS_FILE, DEFAULT_TASKS_FILE
from fb_comment_bot.facebook_actions import CommentAborted, FacebookActions
from fb_comment_bot.human_behavior import human_pause
from fb_comment_bot.io_utils import load_comments, load_tasks
from fb_comment_bot.undetectable_client import UndetectableClient


class FacebookCommentBot:
    """Бот автокомментирования для одного Undetectable-профиля."""

    def __init__(
        self,
        profile_id: str,
        tasks_file: Path = DEFAULT_TASKS_FILE,
        comments_file: Path = DEFAULT_COMMENTS_FILE,
        undetectable: UndetectableClient | None = None,
    ) -> None:
        self.profile_id = profile_id
        self.tasks_file = Path(tasks_file)
        self.comments_file = Path(comments_file)
        self._undetectable = undetectable or UndetectableClient()

    async def run(self) -> None:
        """Запускает профиль, выполняет все задачи и корректно гасит браузер."""
        urls = load_tasks(self.tasks_file)
        comments = load_comments(self.comments_file)
        if not urls:
            logger.warning("Список задач пуст — нечего комментировать")
            return

        ws_url = await self._undetectable.start_profile(self.profile_id)
        try:
            async with async_playwright() as playwright:
                logger.info("Подключение Playwright по CDP: {}", ws_url)
                browser = await playwright.chromium.connect_over_cdp(ws_url)
                page = await self._pick_page(browser)
                actions = FacebookActions(page)

                for index, url in enumerate(urls, start=1):
                    logger.info("Задача {}/{}: {}", index, len(urls), url)
                    comment = random.choice(comments)
                    try:
                        await actions.comment_on_post(url, comment)
                    except CommentAborted as exc:
                        logger.error("Пост пропущен ({}): {}", url, exc)
                    except Exception as exc:
                        logger.exception("Неожиданная ошибка на {}: {}", url, exc)
                        await actions.capture_error("unexpected", url)

                    # Пауза между постами, чтобы снизить риск антиспам-ограничений.
                    if index < len(urls):
                        await human_pause(4.0, 8.0)
        finally:
            # Браузер закрываем через Undetectable API, а не browser.close().
            await self._undetectable.stop_profile(self.profile_id)
            logger.info("Работа завершена")

    @staticmethod
    async def _pick_page(browser: Browser) -> Page:
        """Берёт уже открытую вкладку профиля Undetectable или создаёт новую."""
        if not browser.contexts:
            raise RuntimeError("У CDP-браузера нет контекстов — профиль запущен некорректно")
        context = browser.contexts[0]
        if context.pages:
            return context.pages[0]
        return await context.new_page()
