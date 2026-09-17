import { formatEther } from 'viem';
import { diagnosticLines, splitMessage } from './diagnostics.js';
import { resultLines } from './results.js';
import { recheckReport } from './rechecks.js';
export function localClock(date, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${v.hour}:${v.minute}` };
}
const eth = (x) => Number(formatEther(BigInt(x))).toFixed(6);
export function reportText(store, cfg, now = Date.now()) {
  const since = store.get('lastReportEnd', now - 86400000);
  const rechecks = recheckReport(store, since, now);
  const events = store.db
    .prepare('SELECT kind,count(*) AS n FROM events WHERE ts>=? AND ts<? GROUP BY kind')
    .all(since, now);
  const counts = Object.fromEntries(events.map((e) => [e.kind, e.n]));
  const gaps = store.db
    .prepare("SELECT data FROM events WHERE kind='gap' AND ts>=? AND ts<?")
    .all(since, now)
    .reduce((n, e) => n + JSON.parse(e.data).blocks, 0);
  const nextBlock = store.db
    .prepare("SELECT data FROM events WHERE kind='recheck_ok' AND ts>=? AND ts<?")
    .all(since, now)
    .filter((e) => JSON.parse(e.data).delta === 1).length;
  const signals = store.db
    .prepare('SELECT data FROM signals WHERE ts>=? AND ts<?')
    .all(since, now)
    .map((r) => JSON.parse(r.data));
  const best = new Map();
  for (const s of signals) {
    const old = best.get(s.route);
    if (!old || BigInt(s.net) > BigInt(old.net)) best.set(s.route, s);
  }
  const top = [...best.values()]
    .sort((a, b) => (BigInt(a.net) > BigInt(b.net) ? -1 : 1))
    .slice(0, 3);
  const pools = store.get('pools', []),
    last = store.get('lastBlock');
  const lines = [
    `Ethereum — сводка ${localClock(new Date(now), cfg.zone).date}`,
    'Режим: симуляции, реальные сделки не отправлялись.',
    `Период: ${new Date(since).toISOString()} — ${new Date(now).toISOString()}`,
    `Пулов: ${pools.length}; токенов: ${new Set(pools.map((p) => p.token)).size}`,
    `Снимков состояния: ${counts.scan || 0}; найдено маршрутов-кандидатов: ${counts.candidate || 0}`,
    `Симуляции кандидатов: ${counts.sim_ok || 0} успешных, ${counts.sim_fail || 0} с ошибкой`,
    `Сигналов, достигших действовавшего порога прибыли: ${signals.length}; уникальных маршрутов: ${best.size}`,
    `Повторные проверки: ${counts.recheck_ok || 0} достигли порога из ${(counts.recheck_ok || 0) + (counts.recheck_lost || 0)}; ошибок ${counts.recheck_error || 0}`,
    `Из них подтверждены ровно на следующем блоке: ${nextBlock}; истекли без проверки: ${counts.recheck_expired || 0}`,
    `Пропущено блоков наблюдения: ${gaps}; смен хеша блока / расхождений RPC: ${counts.reorg || 0}; ошибок обновления пулов: ${counts.discovery_error || 0}`,
    `Ошибок сканирования: ${counts.scan_error || 0}; обрывов WS: ${counts.ws_disconnect || 0}`,
    `Последний блок: ${last?.number || 'нет'}; возраст: ${last ? Math.round((now - last.at) / 60000) + ' мин' : 'нет данных'}`,
    `RPC-запросов сегодня (UTC): ${store.get('rpc:' + new Date(now).toISOString().slice(0, 10), 0)} / ${cfg.dailyCalls}`,
    'Это счётчик запросов, не остаток CU провайдера. WS учитывается провайдером отдельно.',
  ];
  for (const s of top)
    lines.push(
      `\n${s.symbol}: вход ${eth(s.input)} WETH; расчётный плюс ${eth(s.net)} WETH\nБлок ${s.block}\nКупить: https://etherscan.io/address/${s.buy}\nПродать: https://etherscan.io/address/${s.sell}`,
      rechecks.forSignal(s),
    );
  if (!top.length) lines.push('\nСигналов, достигших порога прибыли, за период нет.');
  lines.push(...rechecks.lines);
  lines.push(...resultLines(store, cfg, since, now));
  lines.push(...diagnosticLines(store, since, now));
  lines.push(
    '\nРезультаты разных блоков не суммируются в доход. Бюджет газа консервативный; исполнение в будущем не гарантировано.',
  );
  return lines.join('\n');
}
export async function sendTelegram(cfg, text) {
  if (!cfg.telegramToken || !cfg.chat) throw new Error('TELEGRAM_NOT_CONFIGURED');
  for (const chunk of splitMessage(text)) await sendChunk(cfg, chunk);
}
async function sendChunk(cfg, text) {
  const response = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chat, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(15000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('TELEGRAM_INVALID_RESPONSE');
  }
  if (!response.ok || !result.ok) throw new Error('TELEGRAM_SEND_FAILED');
}
export async function scheduledReport(store, cfg, now = Date.now()) {
  const clock = localClock(new Date(now), cfg.zone);
  if (!cfg.telegramToken) return;
  let pending = store.get('pendingReport');
  if (!pending) {
    if (clock.time < cfg.time || store.get('reportDate') === clock.date) return;
    pending = {
      date: clock.date,
      end: now,
      chunks: splitMessage(reportText(store, cfg, now)),
      next: 0,
    };
    store.set('pendingReport', pending);
  }
  for (; pending.next < pending.chunks.length;) {
    await sendChunk(cfg, pending.chunks[pending.next]);
    pending.next++;
    store.set('pendingReport', pending);
  }
  store.set('lastReportEnd', pending.end);
  store.set('reportDate', pending.date);
  store.set('pendingReport', null);
  store.prune();
}
