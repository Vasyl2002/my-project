"""Мок-тесты AdsPower Local API без живого сервиса."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from fb_comment_bot.adspower_client import AdsPowerClient, AdsPowerError


class AdsPowerClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_profile_returns_ws_puppeteer(self) -> None:
        payload = {
            "code": 0,
            "data": {"ws": {"puppeteer": "ws://127.0.0.1:9222/devtools/browser/abc"}},
        }
        response = MagicMock()
        response.json.return_value = payload
        response.raise_for_status = MagicMock()

        client = AdsPowerClient()
        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=response)
        mock_http.__aenter__.return_value = mock_http
        mock_http.__aexit__.return_value = False

        with patch("fb_comment_bot.adspower_client.httpx.AsyncClient", return_value=mock_http):
            ws = await client.start_profile("user123")

        self.assertEqual(ws, "ws://127.0.0.1:9222/devtools/browser/abc")
        args, kwargs = mock_http.get.await_args
        self.assertTrue(args[0].endswith("/api/v1/user/start"))
        self.assertEqual(kwargs["params"], {"user_id": "user123"})

    async def test_start_profile_raises_on_nonzero_code(self) -> None:
        payload = {"code": -1, "msg": "profile not found"}
        response = MagicMock()
        response.json.return_value = payload
        response.raise_for_status = MagicMock()

        client = AdsPowerClient()
        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=response)
        mock_http.__aenter__.return_value = mock_http
        mock_http.__aexit__.return_value = False

        with patch("fb_comment_bot.adspower_client.httpx.AsyncClient", return_value=mock_http):
            with self.assertRaisesRegex(AdsPowerError, "profile not found"):
                await client.start_profile("missing")

    async def test_start_profile_raises_when_api_down(self) -> None:
        client = AdsPowerClient()
        mock_http = AsyncMock()
        mock_http.get = AsyncMock(side_effect=httpx.ConnectError("offline"))
        mock_http.__aenter__.return_value = mock_http
        mock_http.__aexit__.return_value = False

        with patch("fb_comment_bot.adspower_client.httpx.AsyncClient", return_value=mock_http):
            with self.assertRaisesRegex(AdsPowerError, "недоступен"):
                await client.start_profile("user123")

    async def test_stop_profile_does_not_raise(self) -> None:
        client = AdsPowerClient()
        mock_http = AsyncMock()
        mock_http.get = AsyncMock(side_effect=httpx.ConnectError("offline"))
        mock_http.__aenter__.return_value = mock_http
        mock_http.__aexit__.return_value = False

        with patch("fb_comment_bot.adspower_client.httpx.AsyncClient", return_value=mock_http):
            await client.stop_profile("user123")


if __name__ == "__main__":
    unittest.main()
