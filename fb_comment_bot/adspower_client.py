"""Клиент AdsPower Local API: старт/стоп профиля и получение CDP WebSocket."""

from __future__ import annotations

from typing import Any

import httpx
from loguru import logger

from fb_comment_bot.config import (
    ADSPOWER_BASE_URL,
    ADSPOWER_START_PATH,
    ADSPOWER_STOP_PATH,
    ADSPOWER_TIMEOUT_SEC,
)


class AdsPowerError(RuntimeError):
    """Ошибка ответа или недоступности AdsPower Local API."""


class AdsPowerClient:
    """Асинхронная обёртка над Local API AdsPower."""

    def __init__(self, base_url: str = ADSPOWER_BASE_URL, timeout: float = ADSPOWER_TIMEOUT_SEC) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def start_profile(self, profile_id: str) -> str:
        """Запускает профиль и возвращает ws.puppeteer для Playwright CDP."""
        url = f"{self._base_url}{ADSPOWER_START_PATH}"
        params = {"user_id": profile_id}
        logger.info("Запуск AdsPower-профиля {}", profile_id)

        payload = await self._get_json(url, params)
        self._assert_ok(payload, action="start")

        data = payload.get("data") or {}
        ws = data.get("ws") or {}
        ws_url = ws.get("puppeteer")
        if not ws_url:
            raise AdsPowerError(
                f"В ответе AdsPower нет ws.puppeteer: {payload!r}"
            )

        logger.success("Профиль {} запущен, CDP: {}", profile_id, ws_url)
        return str(ws_url)

    async def stop_profile(self, profile_id: str) -> None:
        """Останавливает браузер профиля через AdsPower API."""
        url = f"{self._base_url}{ADSPOWER_STOP_PATH}"
        params = {"user_id": profile_id}
        logger.info("Остановка AdsPower-профиля {}", profile_id)

        try:
            payload = await self._get_json(url, params)
            self._assert_ok(payload, action="stop")
            logger.success("Профиль {} остановлен", profile_id)
        except Exception as exc:
            # Стоп не должен ронять finally: логируем и продолжаем закрытие.
            logger.error("Не удалось остановить профиль {}: {}", profile_id, exc)

    async def _get_json(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            raise AdsPowerError(
                f"AdsPower API недоступен ({url}): {exc}. "
                "Убедитесь, что AdsPower запущен и Local API включён."
            ) from exc

    @staticmethod
    def _assert_ok(payload: dict[str, Any], action: str) -> None:
        # code == 0 — успешный ответ AdsPower.
        code = payload.get("code")
        if code != 0:
            raise AdsPowerError(
                f"AdsPower {action} вернул code={code}: {payload.get('msg') or payload}"
            )
