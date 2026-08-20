"""Поиск элементов Facebook и публикация комментария."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from loguru import logger
from playwright.async_api import Locator, Page, TimeoutError as PlaywrightTimeoutError

from fb_comment_bot.config import (
    BLOCK_OR_CAPTCHA_SELECTORS,
    COMMENT_BOX_SELECTORS,
    ELEMENT_TIMEOUT_MS,
    ERRORS_DIR,
    NAVIGATION_TIMEOUT_MS,
    OPEN_COMPOSER_SELECTORS,
    SUBMIT_SELECTORS,
)
from fb_comment_bot.human_behavior import human_pause, smooth_scroll, type_like_human


class CommentAborted(Exception):
    """Текущий пост нужно пропустить (нет поля, капча, блок и т.п.)."""


class FacebookActions:
    """Действия на странице поста Facebook."""

    def __init__(self, page: Page) -> None:
        self._page = page

    async def comment_on_post(self, url: str, text: str) -> None:
        """Открывает пост, находит композер и отправляет комментарий."""
        logger.info("Переход к посту: {}", url)
        await self._page.goto(url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
        await human_pause(2.0, 4.0)

        if await self._is_blocked_or_captcha():
            await self.capture_error("captcha_or_block", url)
            raise CommentAborted("Обнаружена капча / форма блокировки")

        await smooth_scroll(self._page)
        await human_pause()

        await self._try_open_composer()
        box = await self._find_comment_box()
        if box is None:
            await self.capture_error("comment_box_not_found", url)
            raise CommentAborted("Поле ввода комментария не найдено")

        await human_pause()
        logger.info("Ввод комментария ({} символов)", len(text))
        await type_like_human(box, text)
        await human_pause(1.5, 3.5)
        await self._submit_comment(box)
        logger.success("Комментарий отправлен: {}", url)

    async def capture_error(self, reason: str, url: str) -> Path:
        """Сохраняет скриншот в errors/ и возвращает путь к файлу."""
        ERRORS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        host = urlparse(url).path.replace("/", "_").strip("_")[:40] or "post"
        filename = f"{stamp}_{reason}_{host}.png"
        path = ERRORS_DIR / filename
        try:
            await self._page.screenshot(path=str(path), full_page=True)
            logger.error("Скриншот ошибки сохранён: {}", path)
        except Exception as exc:
            logger.error("Не удалось сделать скриншот: {}", exc)
        return path

    async def _is_blocked_or_captcha(self) -> bool:
        """Проверяет признаки checkpoint / captcha / блокировки."""
        current = self._page.url.lower()
        if "checkpoint" in current or "captcha" in current:
            return True

        for selector in BLOCK_OR_CAPTCHA_SELECTORS:
            locator = self._page.locator(selector)
            try:
                if await locator.count() and await locator.first.is_visible():
                    logger.warning("Сработал индикатор блокировки: {}", selector)
                    return True
            except Exception:
                continue
        return False

    async def _try_open_composer(self) -> None:
        """На части постов композер открывается только после клика «Comment»."""
        for selector in OPEN_COMPOSER_SELECTORS:
            locator = self._page.locator(selector)
            try:
                if await locator.count() == 0:
                    continue
                target = locator.first
                if await target.is_visible():
                    logger.debug("Открываю композер: {}", selector)
                    await human_pause()
                    await target.click(timeout=ELEMENT_TIMEOUT_MS)
                    await human_pause(1.0, 2.5)
                    return
            except PlaywrightTimeoutError:
                continue
            except Exception as exc:
                logger.debug("Не удалось кликнуть композер {}: {}", selector, exc)

    async def _find_comment_box(self) -> Locator | None:
        """Ищет contenteditable-поле комментария по устойчивым селекторам."""
        # Быстрый проход: элемент уже в DOM и видим.
        for selector in COMMENT_BOX_SELECTORS:
            locator = self._page.locator(selector)
            try:
                if await locator.count() and await locator.first.is_visible():
                    logger.debug("Поле комментария найдено: {}", selector)
                    return locator.first
            except Exception as exc:
                logger.debug("Ошибка селектора {}: {}", selector, exc)

        # Медленный проход: ждём появления типичных aria-label.
        for selector in COMMENT_BOX_SELECTORS:
            locator = self._page.locator(selector)
            try:
                await locator.first.wait_for(state="visible", timeout=3_000)
                logger.debug("Поле комментария появилось: {}", selector)
                return locator.first
            except PlaywrightTimeoutError:
                logger.debug("Селектор не сработал: {}", selector)
            except Exception as exc:
                logger.debug("Ошибка селектора {}: {}", selector, exc)
        return None

    async def _submit_comment(self, box: Locator) -> None:
        """Сначала Enter, если не сработало — клик по кнопке отправки."""
        logger.debug("Отправка комментария через Enter")
        await box.press("Enter")
        await human_pause(1.0, 2.0)

        # Если кнопка отправки всё ещё активна — кликаем её.
        for selector in SUBMIT_SELECTORS:
            locator = self._page.locator(selector)
            try:
                if await locator.count() == 0:
                    continue
                button = locator.last
                if await button.is_visible() and await button.is_enabled():
                    logger.debug("Клик по кнопке отправки: {}", selector)
                    await button.click(timeout=ELEMENT_TIMEOUT_MS)
                    return
            except Exception:
                continue
