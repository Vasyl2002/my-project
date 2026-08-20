"""Мок-тесты Undetectable Local API без живого сервиса."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from fb_comment_bot.config import build_undetectable_base_url
from fb_comment_bot.undetectable_client import UndetectableClient, UndetectableError


def _mock_client(get_side_effect=None, get_payload=None, post_side_effect=None, post_payload=None):
    mock_http = AsyncMock()
    if get_side_effect is not None:
        mock_http.get = AsyncMock(side_effect=get_side_effect)
    else:
        response = MagicMock()
        response.json.return_value = get_payload or {"code": 0, "status": "success", "data": {}}
        response.raise_for_status = MagicMock()
        mock_http.get = AsyncMock(return_value=response)
    if post_side_effect is not None:
        mock_http.post = AsyncMock(side_effect=post_side_effect)
    elif post_payload is not None:
        response = MagicMock()
        response.json.return_value = post_payload
        response.raise_for_status = MagicMock()
        mock_http.post = AsyncMock(return_value=response)
    mock_http.__aenter__.return_value = mock_http
    mock_http.__aexit__.return_value = False
    return mock_http


class UndetectableClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_profile_uses_websocket_link(self) -> None:
        payload = {
            "code": 0,
            "status": "success",
            "data": {
                "websocket_link": "ws://127.0.0.1:52967/devtools/browser/abc",
                "debug_port": "52967",
            },
        }
        mock_http = _mock_client(get_payload=payload)
        client = UndetectableClient(base_url="http://127.0.0.1:1984")
        with patch("fb_comment_bot.undetectable_client.httpx.AsyncClient", return_value=mock_http):
            ws = await client.start_profile("user123")

        self.assertEqual(ws, "ws://127.0.0.1:52967/devtools/browser/abc")
        args, _kwargs = mock_http.get.await_args
        self.assertEqual(args[0], "http://127.0.0.1:1984/profile/start/user123")

    async def test_start_profile_builds_cdp_from_debug_port(self) -> None:
        start_payload = {
            "code": 0,
            "status": "success",
            "data": {"debug_port": "52967", "name": "Profile1"},
        }
        version_payload = {
            "webSocketDebuggerUrl": "ws://127.0.0.1:52967/devtools/browser/xyz",
        }

        start_response = MagicMock()
        start_response.json.return_value = start_payload
        start_response.raise_for_status = MagicMock()
        version_response = MagicMock()
        version_response.json.return_value = version_payload
        version_response.raise_for_status = MagicMock()

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(side_effect=[start_response, version_response])
        mock_http.__aenter__.return_value = mock_http
        mock_http.__aexit__.return_value = False

        client = UndetectableClient(base_url="http://127.0.0.1:1984")
        with patch("fb_comment_bot.undetectable_client.httpx.AsyncClient", return_value=mock_http):
            ws = await client.start_profile("user123")

        self.assertEqual(ws, "ws://127.0.0.1:52967/devtools/browser/xyz")
        self.assertEqual(
            mock_http.get.await_args_list[1].args[0],
            "http://127.0.0.1:52967/json/version",
        )

    async def test_start_falls_back_to_browser_start_post(self) -> None:
        post_payload = {
            "code": 0,
            "status": "success",
            "data": {"websocket_link": "ws://127.0.0.1:1111/devtools/browser/fb"},
        }
        mock_http = _mock_client(
            get_side_effect=httpx.HTTPStatusError(
                "404",
                request=httpx.Request("GET", "http://127.0.0.1:1984/profile/start/user123"),
                response=httpx.Response(404),
            ),
            post_payload=post_payload,
        )
        client = UndetectableClient(base_url="http://127.0.0.1:1984")
        with patch("fb_comment_bot.undetectable_client.httpx.AsyncClient", return_value=mock_http):
            ws = await client.start_profile("user123")

        self.assertEqual(ws, "ws://127.0.0.1:1111/devtools/browser/fb")
        args, kwargs = mock_http.post.await_args
        self.assertEqual(args[0], "http://127.0.0.1:1984/api/v1/browser/start")
        self.assertEqual(kwargs["json"]["profile_id"], "user123")

    async def test_start_profile_raises_on_nonzero_code(self) -> None:
        payload = {"code": 1, "status": "error", "data": {"error": "profile not found"}}
        mock_http = _mock_client(get_payload=payload)
        client = UndetectableClient()
        with patch("fb_comment_bot.undetectable_client.httpx.AsyncClient", return_value=mock_http):
            with self.assertRaisesRegex(UndetectableError, "profile not found"):
                await client.start_profile("missing")

    async def test_start_profile_raises_when_api_down(self) -> None:
        mock_http = _mock_client(get_side_effect=httpx.ConnectError("offline"), post_side_effect=httpx.ConnectError("offline"))
        client = UndetectableClient()
        with patch("fb_comment_bot.undetectable_client.httpx.AsyncClient", return_value=mock_http):
            with self.assertRaisesRegex(UndetectableError, "недоступен"):
                await client.start_profile("user123")

    async def test_stop_profile_uses_official_path(self) -> None:
        payload = {"code": 0, "status": "success", "data": {}}
        mock_http = _mock_client(get_payload=payload)
        client = UndetectableClient(base_url="http://127.0.0.1:1984")
        with patch("fb_comment_bot.undetectable_client.httpx.AsyncClient", return_value=mock_http):
            await client.stop_profile("user123")
        args, _kwargs = mock_http.get.await_args
        self.assertEqual(args[0], "http://127.0.0.1:1984/profile/stop/user123")

    async def test_stop_profile_does_not_raise(self) -> None:
        mock_http = _mock_client(
            get_side_effect=httpx.ConnectError("offline"),
            post_side_effect=httpx.ConnectError("offline"),
        )
        client = UndetectableClient()
        with patch("fb_comment_bot.undetectable_client.httpx.AsyncClient", return_value=mock_http):
            await client.stop_profile("user123")


class BaseUrlTests(unittest.TestCase):
    def test_cli_port_overrides_default(self) -> None:
        self.assertEqual(
            build_undetectable_base_url(api_port=25325),
            "http://127.0.0.1:25325",
        )

    def test_cli_url_wins(self) -> None:
        self.assertEqual(
            build_undetectable_base_url(api_url="http://localhost:9000/", api_port=1),
            "http://localhost:9000",
        )


if __name__ == "__main__":
    unittest.main()
