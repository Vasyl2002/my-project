"""Константы и настройки бота."""

from __future__ import annotations

import os
from pathlib import Path

# --- Undetectable Local API ---
# Порт задаётся в настройках Undetectable (API address). Заводской — 25325;
# здесь по умолчанию 1984, как часто выставляют вручную. Переопределение:
#   UNDETECTABLE_BASE_URL=http://127.0.0.1:25325
#   UNDETECTABLE_HOST / UNDETECTABLE_PORT
UNDETECTABLE_HOST = os.getenv("UNDETECTABLE_HOST", "127.0.0.1")
UNDETECTABLE_PORT = os.getenv("UNDETECTABLE_PORT", "1984")
UNDETECTABLE_BASE_URL = os.getenv(
    "UNDETECTABLE_BASE_URL",
    f"http://{UNDETECTABLE_HOST}:{UNDETECTABLE_PORT}",
).rstrip("/")
UNDETECTABLE_TIMEOUT_SEC = float(os.getenv("UNDETECTABLE_TIMEOUT", "60"))

# Официальный Local API v1.5: GET /profile/start/{id} и GET /profile/stop/{id}.
# Альтернативные пути (если в сборке другой префикс) — через env.
UNDETECTABLE_START_PATH = os.getenv("UNDETECTABLE_START_PATH", "/profile/start")
UNDETECTABLE_STOP_PATH = os.getenv("UNDETECTABLE_STOP_PATH", "/profile/stop")


def build_undetectable_base_url(*, api_url: str | None = None, api_port: int | str | None = None) -> str:
    """Собирает базовый URL Local API из CLI/env."""
    if api_url:
        return api_url.rstrip("/")
    if api_port is not None:
        return f"http://{UNDETECTABLE_HOST}:{api_port}"
    return UNDETECTABLE_BASE_URL


# --- Пути по умолчанию ---
ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_TASKS_FILE = ROOT_DIR / "tasks.json"
DEFAULT_COMMENTS_FILE = ROOT_DIR / "comments.txt"
LOG_FILE = ROOT_DIR / "bot.log"
ERRORS_DIR = ROOT_DIR / "errors"

# --- Человекоподобные задержки (секунды / миллисекунды) ---
CLICK_DELAY_RANGE_SEC = (3.0, 7.0)
TYPE_DELAY_RANGE_MS = (50, 150)
NAVIGATION_TIMEOUT_MS = 45_000
ELEMENT_TIMEOUT_MS = 15_000

# Устойчивые селекторы поля комментария Facebook.
# Aria-label зависит от языка интерфейса, поэтому держим EN/RU и XPath-фолбэки.
COMMENT_BOX_SELECTORS: tuple[str, ...] = (
    '[aria-label="Write a comment…"]',
    '[aria-label="Write a comment..."]',
    '[aria-label="Write a comment"]',
    '[aria-label="Напишите комментарий…"]',
    '[aria-label="Напишите комментарий..."]',
    '[aria-label="Напишите комментарий"]',
    'div[role="textbox"][contenteditable="true"][aria-label*="comment" i]',
    'div[role="textbox"][contenteditable="true"][aria-label*="коммент" i]',
    'xpath=//div[@role="textbox" and @contenteditable="true" and '
    '(contains(translate(@aria-label, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "comment") '
    'or contains(@aria-label, "коммент") or contains(@aria-label, "Коммент"))]',
    'xpath=//form[.//div[@role="textbox"]]//div[@role="textbox" and @contenteditable="true"]',
)

# Кнопка, которая раскрывает композер (на некоторых постах поле скрыто).
# Не используем голое aria-label="Comment" — это же значение бывает у кнопки отправки.
OPEN_COMPOSER_SELECTORS: tuple[str, ...] = (
    '[aria-label="Leave a comment"]',
    '[aria-label="Оставить комментарий"]',
    'div[aria-label="Leave a comment"][role="button"]',
    'xpath=//span[normalize-space()="Comment" or normalize-space()="Комментарий"]/ancestor::div[@role="button"][1]',
)

# Кнопка отправки (иконка «самолётик» / Post / Отправить).
SUBMIT_SELECTORS: tuple[str, ...] = (
    '[aria-label="Comment"][role="button"]',
    '[aria-label="Post"][role="button"]',
    '[aria-label="Отправить"]',
    '[aria-label="Отправить комментарий"]',
    '[aria-label="Комментировать"][role="button"]',
    'xpath=//div[@role="button" and (@aria-label="Comment" or @aria-label="Post" or contains(@aria-label, "Отправить"))]',
)

# Признаки капчи, чекпоинта и блокировки аккаунта.
BLOCK_OR_CAPTCHA_SELECTORS: tuple[str, ...] = (
    'iframe[src*="captcha" i]',
    'iframe[title*="captcha" i]',
    '[id*="captcha" i]',
    'form[action*="checkpoint"]',
    'xpath=//*[contains(@action, "checkpoint")]',
    'xpath=//*[contains(text(), "unusual activity")]',
    'xpath=//*[contains(text(), "We suspect automated")]',
    'xpath=//*[contains(text(), "Enter the characters")]',
    'xpath=//*[contains(text(), "подозрительн")]',
    'xpath=//*[contains(text(), "подтвердите, что вы")]',
    'xpath=//*[contains(text(), "введите символы")]',
    'xpath=//*[contains(text(), "Ваш аккаунт заблокирован")]',
    'xpath=//*[contains(text(), "Your account has been disabled")]',
)
