"""Константы и настройки бота."""

from pathlib import Path

# --- AdsPower Local API ---
ADSPOWER_BASE_URL = "http://local.adspower.net:50325"
ADSPOWER_START_PATH = "/api/v1/user/start"
ADSPOWER_STOP_PATH = "/api/v1/user/stop"
ADSPOWER_TIMEOUT_SEC = 60.0

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
