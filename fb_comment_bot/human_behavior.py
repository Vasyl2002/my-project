"""Эмуляция человеческих пауз, скролла и посимвольного ввода."""

from __future__ import annotations

import asyncio
import random

from loguru import logger
from playwright.async_api import Locator, Page

from fb_comment_bot.config import CLICK_DELAY_RANGE_SEC, TYPE_DELAY_RANGE_MS


async def human_pause(lo: float | None = None, hi: float | None = None) -> None:
    """Случайная пауза перед кликом / действием."""
    low = CLICK_DELAY_RANGE_SEC[0] if lo is None else lo
    high = CLICK_DELAY_RANGE_SEC[1] if hi is None else hi
    delay = random.uniform(low, high)
    logger.debug("Пауза {:.2f} с", delay)
    await asyncio.sleep(delay)


async def smooth_scroll(page: Page, distance: int | None = None, steps: int | None = None) -> None:
    """Плавно прокручивает страницу вниз небольшими шагами."""
    total = distance if distance is not None else random.randint(450, 1100)
    n_steps = steps if steps is not None else random.randint(8, 16)
    step = total / n_steps
    logger.debug("Плавный скролл на {}px за {} шагов", total, n_steps)
    for _ in range(n_steps):
        await page.mouse.wheel(0, step)
        await asyncio.sleep(random.uniform(0.04, 0.16))


async def type_like_human(locator: Locator, text: str) -> None:
    """Вводит текст посимвольно с задержкой 50–150 мс, без вставки из буфера."""
    await locator.click()
    await asyncio.sleep(random.uniform(0.25, 0.7))
    for char in text:
        await locator.press_sequentially(char, delay=0)
        await asyncio.sleep(random.randint(*TYPE_DELAY_RANGE_MS) / 1000)
        if char in {" ", ",", "."} and random.random() < 0.25:
            await asyncio.sleep(random.uniform(0.12, 0.35))
