import { formatEther } from 'viem';
const eth = (value) => Number(formatEther(BigInt(value))).toFixed(6);
const pct = (bps) => (bps / 100).toFixed(3) + '%';
export function filterReason(r, threshold) {
  if (r.rawBps <= 0) return 'нет ценового преимущества';
  if (r.bps <= 0) return 'разницу поглощают комиссии';
  if (r.bps <= threshold) return 'ниже фильтра ' + pct(threshold);
  return 'прошёл фильтр; нужна симуляция';
}
export function controlReason(s) {
  if (BigInt(s.output) <= BigInt(s.input)) return 'убыток уже на обменах';
  if (BigInt(s.net) <= 0n) return 'прибыль поглощает бюджет газа';
  if (BigInt(s.net) < BigInt(s.minProfit)) return 'ниже минимальной прибыли';
  return 'выше минимальной прибыли';
}
export function diagnosticLines(store, since, now) {
  const rows = (kind) =>
    store.db
      .prepare('SELECT ts,data FROM events WHERE kind=? AND ts>=? AND ts<? ORDER BY id')
      .all(kind, since, now);
  const scans = rows('scan')
    .map((r) => JSON.parse(r.data).intervalMs)
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  const lines = ['\nДиагностика поиска (данные с момента обновления):'];
  if (scans.length) {
    const average = scans.reduce((a, b) => a + b, 0) / scans.length;
    lines.push(
      `Интервал снимков: средний ${(average / 1000).toFixed(1)} с; p95 ${(scans[Math.ceil(scans.length * 0.95) - 1] / 1000).toFixed(1)} с; максимум ${(scans.at(-1) / 1000).toFixed(1)} с.`,
    );
  } else lines.push('Интервалы: пока недостаточно новых снимков.');
  const health = new Map();
  for (const row of rows('pool_sample')) {
    const sample = JSON.parse(row.data),
      failed = new Set(sample.failed);
    for (const address of sample.pools) {
      const h = health.get(address) || { address, reads: 0, failed: 0 };
      h.reads++;
      if (failed.has(address)) h.failed++;
      health.set(address, h);
    }
  }
  if (health.size) {
    const all = [...health.values()],
      reads = all.reduce((n, p) => n + p.reads, 0),
      failed = all.reduce((n, p) => n + p.failed, 0);
    lines.push(
      `Чтения пулов: ${reads - failed}/${reads} успешных (${(((reads - failed) / reads) * 100).toFixed(2)}%); проверено адресов: ${health.size}.`,
    );
    for (const p of all
      .filter((p) => p.failed)
      .sort((a, b) => b.failed / b.reads - a.failed / a.reads)
      .slice(0, 3))
      lines.push(`Сбои ${p.address}: ${p.failed}/${p.reads} чтений.`);
  } else lines.push('Доступность пулов: ещё нет измерений.');
  const best = new Map();
  for (const row of rows('near_routes')) {
    const sample = JSON.parse(row.data);
    for (const r of sample.routes) {
      const old = best.get(r.key);
      if (!old || r.bps > old.bps)
        best.set(r.key, { ...r, block: sample.block, threshold: sample.thresholdBps });
    }
  }
  lines.push('\nБлижайшие маршруты — оценка цены, НЕ прибыль:');
  for (const r of [...best.values()].sort((a, b) => b.bps - a.bps).slice(0, 3)) {
    lines.push(
      `${r.symbol} | ${r.buyVenue || 'пул'} ${pct(r.buyFee / 100)} → ${r.sellVenue || 'пул'} ${pct(r.sellFee / 100)} | блок ${r.block}\nРазрыв ${pct(r.rawBps)}; после комиссий ${pct(r.bps)}: ${filterReason(r, r.threshold)}.\n${r.buy} → ${r.sell}`,
    );
  }
  if (!best.size) lines.push('Нет сопоставимых маршрутов в новых измерениях.');
  const attempts = rows('control_attempt'),
    ok = rows('control_ok'),
    failed = rows('control_fail');
  lines.push(
    `\nКонтрольные симуляции: попыток ${attempts.length}, подтверждено ${ok.length}, ошибок ${failed.length}.`,
  );
  const last = ok.at(-1);
  if (last) {
    const s = JSON.parse(last.data);
    lines.push(
      `Последняя: ${s.symbol}, блок ${s.block}. Вход ${eth(s.input)}, выход ${eth(s.output)} WETH; газ-бюджет ${eth(s.gasBudget)} ETH; итог ${eth(s.net)} WETH — ${controlReason(s)}.`,
    );
  } else lines.push('Нет подтверждённого контрольного результата за период.');
  if (failed.length)
    lines.push('Последняя ошибка контроля: ' + JSON.parse(failed.at(-1).data).code);
  return lines;
}
// Stay under Telegram's 4096-character limit without breaking surrogate pairs.
export function splitMessage(text, limit = 3500) {
  const chunks = [];
  while (text.length > limit) {
    let end = text.lastIndexOf('\n', limit);
    if (end < limit / 2) end = limit;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
    if (text.startsWith('\n')) text = text.slice(1);
  }
  if (text) chunks.push(text);
  return chunks;
}
