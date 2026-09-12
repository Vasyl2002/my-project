import { config } from './config.js';
// Allow obtaining chat_id before TELEGRAM_CHAT_ID is set.
const cfg = config({
  ...process.env,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_BOT_TOKEN ? 'setup' : '',
});
if (!cfg.telegramToken) {
  console.error('Set TELEGRAM_BOT_TOKEN in .env first.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/getUpdates`, {
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error();
    const ids = [
      ...new Set(
        body.result.map((u) => u.message?.chat?.id || u.channel_post?.chat?.id).filter(Boolean),
      ),
    ];
    console.log(
      ids.length ? ids.join('\n') : 'No chats found. Press Start in your bot and try again.',
    );
  } catch {
    console.error('Telegram setup failed. Check the bot token and connection.');
    process.exitCode = 1;
  }
}
