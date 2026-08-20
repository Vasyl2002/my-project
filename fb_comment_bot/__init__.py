"""Асинхронный бот автокомментирования Facebook через Undetectable + Playwright."""

__all__ = ["FacebookCommentBot"]


def __getattr__(name: str):
    if name == "FacebookCommentBot":
        from fb_comment_bot.bot import FacebookCommentBot

        return FacebookCommentBot
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
