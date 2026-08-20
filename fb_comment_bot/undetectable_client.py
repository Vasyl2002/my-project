"""Клиент Undetectable Local API: старт/стоп профиля и CDP WebSocket."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx
from loguru import logger

from fb_comment_bot.config import (
    UNDETECTABLE_BASE_URL,
    UNDETECTABLE_START_PATH,
    UNDETECTABLE_STOP_PATH,
    UNDETECTABLE_TIMEOUT_SEC,
)


class UndetectableError(RuntimeError):
    """Ошибка ответа или недоступности Undetectable Local API."""


class UndetectableClient:
    """Асинхронная обёртка над Local API Undetectable (v1.5)."""

    def __init__(
        self,
        base_url: str = UNDETECTABLE_BASE_URL,
        timeout: float = UNDETECTABLE_TIMEOUT_SEC,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def start_profile(self, profile_id: str) -> str:
        """Запускает профиль и возвращает ws_url для Playwright CDP."""
        logger.info("Запуск Undetectable-профиля {}", profile_id)
        payload = await self._request_start(profile_id)
        self._assert_ok(payload, action="start")

        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        ws_url = await self._extract_cdp_endpoint(data if isinstance(data, dict) else {})
        logger.success("Профиль {} запущен, CDP: {}", profile_id, ws_url)
        return ws_url

    async def stop_profile(self, profile_id: str) -> None:
        """Останавливает браузер профиля через Undetectable API."""
        logger.info("Остановка Undetectable-профиля {}", profile_id)
        try:
            payload = await self._request_stop(profile_id)
            self._assert_ok(payload, action="stop")
            logger.success("Профиль {} остановлен", profile_id)
        except Exception as exc:
            # Стоп не должен ронять finally: логируем и продолжаем закрытие.
            logger.error("Не удалось остановить профиль {}: {}", profile_id, exc)

    async def _request_start(self, profile_id: str) -> dict[str, Any]:
        """Пробует официальный GET /profile/start/{id}, затем POST /api/v1/browser/start."""
        return await self._request_with_fallback(
            profile_id,
            official_path=UNDETECTABLE_START_PATH,
            fallback_path="/api/v1/browser/start",
        )

    async def _request_stop(self, profile_id: str) -> dict[str, Any]:
        """Пробует официальный GET /profile/stop/{id}, затем POST /api/v1/browser/stop."""
        return await self._request_with_fallback(
            profile_id,
            official_path=UNDETECTABLE_STOP_PATH,
            fallback_path="/api/v1/browser/stop",
        )

    async def _request_with_fallback(
        self,
        profile_id: str,
        *,
        official_path: str,
        fallback_path: str,
    ) -> dict[str, Any]:
        official_url = self._profile_url(official_path, profile_id)
        try:
            return await self._get_json(official_url)
        except UndetectableError as primary_exc:
            fallback_url = f"{self._base_url}{fallback_path}"
            if official_url.rstrip("/") == fallback_url.rstrip("/"):
                raise
            logger.debug(
                "GET {} не сработал ({}), пробую POST {}",
                official_url,
                primary_exc,
                fallback_url,
            )
            try:
                return await self._post_json(
                    fallback_url,
                    {"profile_id": profile_id, "id": profile_id},
                )
            except UndetectableError as fallback_exc:
                raise UndetectableError(
                    f"Не удалось выполнить запрос для профиля {profile_id}. "
                    f"GET {official_url}: {primary_exc}; POST {fallback_url}: {fallback_exc}"
                ) from fallback_exc

    def _profile_url(self, path: str, profile_id: str) -> str:
        """Собирает URL старта/стопа: /profile/start/{id} или /api/v1/browser/start?id=."""
        template = path if path.startswith("/") else f"/{path}"
        if "{profile_id}" in template or "{id}" in template:
            filled = template.format(profile_id=profile_id, id=profile_id)
            return f"{self._base_url}{filled}"
        # Официальный стиль: /profile/start/<uuid>
        if template.rstrip("/").endswith(("/start", "/stop")):
            return f"{self._base_url}{template.rstrip('/')}/{profile_id}"
        return f"{self._base_url}{template}"

    async def _extract_cdp_endpoint(self, data: dict[str, Any]) -> str:
        """Достаёт websocket_link или собирает CDP URL из debug_port."""
        for key in ("websocket_link", "websocketLink", "ws_url", "webSocketDebuggerUrl"):
            value = data.get(key)
            if value:
                return str(value)

        nested = data.get("ws")
        if isinstance(nested, str) and nested.startswith(("ws://", "wss://", "http://")):
            return nested
        if isinstance(nested, dict):
            for key in ("puppeteer", "playwright", "browser", "cdp"):
                if nested.get(key):
                    return str(nested[key])

        port = data.get("debug_port") or data.get("debugging_port") or data.get("debugPort")
        if port:
            host = urlparse(self._base_url).hostname or "127.0.0.1"
            return await self._ws_url_from_debug_port(host, str(port))

        raise UndetectableError(
            f"В ответе Undetectable нет websocket_link / debug_port: {data!r}"
        )

    async def _ws_url_from_debug_port(self, host: str, port: str) -> str:
        """Читает webSocketDebuggerUrl с debugging-порта; иначе отдаёт http CDP endpoint."""
        version_url = f"http://{host}:{port}/json/version"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(version_url)
                response.raise_for_status()
                ws_url = (response.json() or {}).get("webSocketDebuggerUrl")
                if ws_url:
                    logger.debug("CDP WebSocket из /json/version: {}", ws_url)
                    return str(ws_url)
        except Exception as exc:
            logger.debug("Не удалось прочитать {}: {}", version_url, exc)
        # Playwright.connect_over_cdp принимает и http://host:debug_port
        return f"http://{host}:{port}"

    async def _get_json(self, url: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            raise UndetectableError(
                f"Undetectable API недоступен ({url}): {exc}. "
                "Убедитесь, что Undetectable запущен и в настройках включён Local API "
                f"(сейчас {self._base_url})."
            ) from exc

    async def _post_json(self, url: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(url, json=body)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            raise UndetectableError(
                f"Undetectable API недоступен ({url}): {exc}. "
                "Убедитесь, что Undetectable запущен и в настройках включён Local API "
                f"(сейчас {self._base_url})."
            ) from exc

    @staticmethod
    def _assert_ok(payload: dict[str, Any], action: str) -> None:
        # code == 0 / status == success — успешный ответ Undetectable.
        code = payload.get("code")
        status = str(payload.get("status") or "").lower()
        if code in (0, "0") or status == "success":
            return
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        detail = (
            payload.get("msg")
            or (data.get("error") if isinstance(data, dict) else None)
            or payload
        )
        raise UndetectableError(f"Undetectable {action} вернул code={code}: {detail}")
